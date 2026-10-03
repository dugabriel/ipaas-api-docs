#!/usr/bin/env node
// Porta em Node do tools/dereference.py, para máquinas sem Python.
// Mantém o mesmo comportamento: resolve $ref, mescla allOf, remove
// discriminators e securitySchemes com `in: query`, valida os requisitos
// do importador do iPaaS (tags, summary, array sem items no requestBody) e
// grava <nome>.ipaas.json para cada openapi*.json da pasta.
//
// Uso:  node tools/dereference.mjs biodoc
//       node tools/dereference.mjs --all

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIMITE_PROFUNDIDADE = 200;
const METODOS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];

function resolverPonteiro(spec, ref) {
  if (!ref.startsWith('#/')) throw new Error(`$ref externo não suportado: ${ref}`);
  let no = spec;
  for (let parte of ref.slice(2).split('/')) {
    parte = parte.replace(/~1/g, '/').replace(/~0/g, '~');
    if (no == null || !(parte in no)) throw new Error(`$ref não resolve: ${ref}`);
    no = no[parte];
  }
  return no;
}

function mesclarAllOf(partes) {
  let resultado = { type: 'object', properties: {} };
  const requeridos = [];
  for (const parte of partes) {
    if (parte.type && parte.type !== 'object') {
      resultado = { ...parte };
      continue;
    }
    Object.assign(resultado.properties, parte.properties || {});
    requeridos.push(...(parte.required || []));
    for (const chave of ['description', 'example']) {
      if (chave in parte && !(chave in resultado)) resultado[chave] = parte[chave];
    }
  }
  if (requeridos.length) resultado.required = [...new Set(requeridos)].sort();
  if (resultado.properties && Object.keys(resultado.properties).length === 0) delete resultado.properties;
  return resultado;
}

function dereferenciar(no, spec, profundidade = 0, vistos = new Set()) {
  if (profundidade > LIMITE_PROFUNDIDADE) throw new Error('profundidade excedida: possível $ref circular');
  if (Array.isArray(no)) return no.map((i) => dereferenciar(i, spec, profundidade + 1, vistos));
  if (no && typeof no === 'object') {
    if ('$ref' in no) {
      const ref = no['$ref'];
      if (vistos.has(ref)) throw new Error(`$ref circular: ${ref}`);
      const alvo = resolverPonteiro(spec, ref);
      const novosVistos = new Set(vistos).add(ref);
      let resolvido = dereferenciar(alvo, spec, profundidade + 1, novosVistos);
      const irmaos = Object.fromEntries(Object.entries(no).filter(([k]) => k !== '$ref'));
      if (Object.keys(irmaos).length) resolvido = { ...resolvido, ...dereferenciar(irmaos, spec, profundidade + 1, vistos) };
      return resolvido;
    }
    if ('allOf' in no) {
      const partes = no['allOf'].map((p) => dereferenciar(p, spec, profundidade + 1, vistos));
      const mesclado = mesclarAllOf(partes);
      const resto = Object.fromEntries(Object.entries(no).filter(([k]) => k !== 'allOf'));
      return { ...mesclado, ...dereferenciar(resto, spec, profundidade + 1, vistos) };
    }
    return Object.fromEntries(Object.entries(no).map(([k, v]) => [k, dereferenciar(v, spec, profundidade + 1, vistos)]));
  }
  return no;
}

function arraysSemItems(no, caminho = '', out = []) {
  if (Array.isArray(no)) {
    no.forEach((v, i) => arraysSemItems(v, `${caminho}[${i}]`, out));
  } else if (no && typeof no === 'object') {
    if (no.type === 'array' && !('items' in no)) out.push(caminho.replace(/^\./, '') || '(raiz)');
    for (const [k, v] of Object.entries(no)) arraysSemItems(v, caminho + '.' + k, out);
  }
  return out;
}

function validarParaIpaas(spec) {
  const problemas = [];
  for (const [caminho, metodos] of Object.entries(spec.paths || {})) {
    for (const [metodo, op] of Object.entries(metodos)) {
      if (!METODOS.includes(metodo)) continue;
      const alvo = `${metodo.toUpperCase()} ${caminho}`;
      if (!op.tags || !op.tags.length) problemas.push(`${alvo}: sem 'tags' — o import falha com HTTP 500`);
      if (!op.summary) problemas.push(`${alvo}: sem 'summary' — recurso fica sem nome descritivo`);
      for (const onde of arraysSemItems(op.requestBody || {})) {
        problemas.push(`${alvo}: 'type: array' sem 'items' no requestBody, em ${onde} — o import responde HTTP 200 e não cria recurso nenhum`);
      }
    }
  }
  return problemas;
}

function removerEsquemasEmQuery(spec) {
  const esquemas = (spec.components || {}).securitySchemes || {};
  const removidos = Object.entries(esquemas).filter(([, e]) => e && typeof e === 'object' && e.in === 'query').map(([n]) => n);
  if (!removidos.length) return [];
  for (const nome of removidos) delete esquemas[nome];
  if (Object.keys(esquemas).length === 0 && spec.components) delete spec.components.securitySchemes;
  const requisitos = [];
  for (const req of spec.security || []) {
    const resto = Object.fromEntries(Object.entries(req).filter(([k]) => !removidos.includes(k)));
    if (Object.keys(resto).length) requisitos.push(resto);
  }
  if (requisitos.length) spec.security = requisitos;
  else delete spec.security;
  return removidos;
}

function removerDiscriminators(no) {
  if (Array.isArray(no)) return no.map(removerDiscriminators);
  if (no && typeof no === 'object') {
    return Object.fromEntries(Object.entries(no).filter(([k]) => k !== 'discriminator').map(([k, v]) => [k, removerDiscriminators(v)]));
  }
  return no;
}

// Colapsa `oneOf`/`anyOf` em um único schema. Verificado no Mailchimp: um
// `oneOf` de 41 membros (tipos de condição de segmento), aninhado fundo na
// resposta de GET /lists e GET /campaigns, faz o import-swagger responder
// HTTP 200 e criar ZERO recurso — a spec inteira do serviço não importa, sem
// mensagem de erro (mesmo padrão silencioso do array sem items). Os serviços
// sem esse construto (Relatórios, Templates) importaram normais.
//
// O iPaaS não usa a discriminação em tempo de mapeamento de campos, então
// unir os membros num objeto (união das properties) preserva os campos e
// remove o ramo profundo que quebra o importador. Membros escalares ou
// mistos caem no primeiro membro. Roda após dereferência (os membros já
// estão expandidos) e após remover discriminator (o `mapping` já saiu).
function colapsarOneOf(no) {
  if (Array.isArray(no)) return no.map(colapsarOneOf);
  if (no && typeof no === 'object') {
    let atual = no;
    for (const chave of ['oneOf', 'anyOf']) {
      if (Array.isArray(atual[chave])) {
        const membros = atual[chave].map(colapsarOneOf);
        const resto = Object.fromEntries(Object.entries(atual).filter(([k]) => k !== chave));
        const objetos = membros.filter((m) => m && typeof m === 'object' && (m.properties || m.type === 'object'));
        if (objetos.length) {
          const props = {};
          const req = [];
          for (const m of objetos) {
            Object.assign(props, m.properties || {});
            if (Array.isArray(m.required)) req.push(...m.required);
          }
          const uniao = { type: 'object' };
          if (Object.keys(props).length) uniao.properties = props;
          if (req.length) uniao.required = [...new Set(req)].sort();
          atual = { ...uniao, ...resto };
        } else {
          // sem membros-objeto: usa o primeiro membro e descarta o resto do ramo
          atual = { ...(membros[0] || {}), ...resto };
        }
      }
    }
    return Object.fromEntries(Object.entries(atual).map(([k, v]) => [k, colapsarOneOf(v)]));
  }
  return no;
}

function processar(pasta) {
  const origens = fs.readdirSync(pasta)
    .filter((f) => f.startsWith('openapi') && f.endsWith('.json') && !f.endsWith('.ipaas.json'))
    .sort();
  if (!origens.length) {
    console.log(`  ignorado: ${path.basename(pasta)} (sem openapi*.json)`);
    return true;
  }
  let ok = true;
  for (const nome of origens) {
    const origem = path.join(pasta, nome);
    const spec = JSON.parse(fs.readFileSync(origem, 'utf-8'));
    let plano = dereferenciar(spec, spec);
    plano = removerDiscriminators(plano);
    plano = colapsarOneOf(plano);
    const problemas = validarParaIpaas(plano);
    const emQuery = removerEsquemasEmQuery(plano);
    if (emQuery.length) console.log(`    securitySchemes em query removidos: ${emQuery.join(', ')} (quebram o importador; a conta do iPaaS injeta os parâmetros)`);
    const seguranca = (plano.components || {}).securitySchemes;
    if (seguranca) plano.components = { securitySchemes: seguranca };
    else delete plano.components;

    const serial = JSON.stringify(plano);
    if ((serial.match(/"\$ref"/g) || []).length) problemas.push('ainda restam $ref após a dereferência');
    const pendurados = (serial.match(/#\/components\/schemas\//g) || []).length;
    if (pendurados) problemas.push(`${pendurados} referências penduradas a '#/components/schemas/' em strings`);

    const base = nome.replace(/\.json$/, '');
    const destino = path.join(pasta, base + '.ipaas.json');
    fs.writeFileSync(destino, JSON.stringify(plano, null, 2) + '\n', 'utf-8');

    let ops = 0;
    for (const metodos of Object.values(plano.paths || {})) {
      ops += Object.keys(metodos).filter((m) => ['get', 'post', 'put', 'delete', 'patch'].includes(m)).length;
    }
    const kb = Math.floor(fs.statSync(destino).size / 1024);
    console.log(`  ${path.basename(pasta)}/${nome}: ${ops} operações -> ${path.basename(destino)} (${kb} KB)`);
    for (const p of problemas) console.log(`    AVISO ${p}`);
    ok = ok && problemas.length === 0;
  }
  return ok;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log('Uso: node tools/dereference.mjs <app> | --all');
    return 1;
  }
  let pastas;
  if (args.length === 1 && args[0] === '--all') {
    pastas = fs.readdirSync(RAIZ)
      .filter((d) => fs.statSync(path.join(RAIZ, d)).isDirectory() && !d.startsWith('.') && !d.startsWith('_') && d !== 'tools')
      .sort()
      .map((d) => path.join(RAIZ, d));
  } else {
    pastas = args.map((a) => path.join(RAIZ, a));
  }
  let ok = true;
  console.log('Gerando specs para o iPaaS:');
  for (const pasta of pastas) {
    if (!fs.existsSync(pasta) || !fs.statSync(pasta).isDirectory()) {
      console.log(`  ERRO ${path.basename(pasta)}: pasta não encontrada`);
      ok = false;
      continue;
    }
    ok = processar(pasta) && ok;
  }
  return ok ? 0 : 1;
}

process.exit(main());
