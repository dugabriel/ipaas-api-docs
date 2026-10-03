#!/usr/bin/env node
// Porta em Node do tools/slice_spec.py, para máquinas sem Python.
// Recorta uma spec OpenAPI grande em specs menores, uma por tag, mantendo
// apenas os `components` alcançáveis por cada recorte. Mesmo comportamento
// do .py: fechamento transitivo de $ref tolerante a ciclo, preserva
// securitySchemes (referenciado por `security`, não por $ref) e avisa quando
// o recorte passa de LIMITE operações.
//
// Uso:  node tools/slice_spec.mjs <spec-origem> <pasta-destino> "Tag=slug" [...]

import fs from 'node:fs';
import path from 'node:path';

const METODOS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];
const LIMITE = 60;

function refsDe(no, encontrados) {
  if (Array.isArray(no)) {
    for (const i of no) refsDe(i, encontrados);
  } else if (no && typeof no === 'object') {
    for (const [k, v] of Object.entries(no)) {
      if (k === '$ref' && typeof v === 'string' && v.startsWith('#/')) encontrados.add(v);
      else refsDe(v, encontrados);
    }
  }
}

function resolverPonteiro(spec, ref) {
  let no = spec;
  for (let parte of ref.slice(2).split('/')) {
    parte = parte.replace(/~1/g, '/').replace(/~0/g, '~');
    if (no == null || !(parte in no)) return null;
    no = no[parte];
  }
  return no;
}

function fechamento(spec, refsIniciais) {
  const vistos = new Set();
  const fila = [...refsIniciais];
  while (fila.length) {
    const ref = fila.pop();
    if (vistos.has(ref)) continue;
    vistos.add(ref);
    const alvo = resolverPonteiro(spec, ref);
    if (alvo == null) {
      console.log(`    AVISO $ref não resolve: ${ref}`);
      continue;
    }
    const novos = new Set();
    refsDe(alvo, novos);
    for (const n of novos) if (!vistos.has(n)) fila.push(n);
  }
  return vistos;
}

function inserir(destino, ref, valor) {
  const partes = ref.slice(2).split('/');
  let no = destino;
  for (const p of partes.slice(0, -1)) {
    if (!(p in no)) no[p] = {};
    no = no[p];
  }
  no[partes[partes.length - 1]] = valor;
}

function recortar(spec, tags) {
  const conjunto = new Set(tags);
  const paths = {};
  for (const [caminho, metodos] of Object.entries(spec.paths || {})) {
    const selecionados = {};
    for (const [m, op] of Object.entries(metodos)) {
      if (METODOS.includes(m) && (op.tags || []).some((t) => conjunto.has(t))) selecionados[m] = op;
    }
    if (Object.keys(selecionados).length) {
      const comuns = Object.fromEntries(Object.entries(metodos).filter(([k]) => !METODOS.includes(k)));
      paths[caminho] = { ...comuns, ...selecionados };
    }
  }
  if (!Object.keys(paths).length) return null;

  const refs = new Set();
  refsDe(paths, refs);
  const necessarios = fechamento(spec, refs);

  const novo = {
    openapi: spec.openapi || '3.0.1',
    info: { ...(spec.info || {}), title: `${spec.info?.title || 'API'} - ${tags.join('/')}` },
    servers: spec.servers || [],
    tags: (spec.tags || []).filter((t) => conjunto.has(t.name)),
    paths,
  };
  if (spec.security) novo.security = spec.security;

  const esquemas = (spec.components || {}).securitySchemes;
  if (esquemas) {
    novo.components = novo.components || {};
    novo.components.securitySchemes = esquemas;
  }

  for (const ref of [...necessarios].sort()) {
    const alvo = resolverPonteiro(spec, ref);
    if (alvo != null) inserir(novo, ref, alvo);
  }
  return novo;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log('Uso: node tools/slice_spec.mjs <spec-origem> <pasta-destino> "Tag=slug" [...]');
    console.log('  Múltiplas tags no mesmo serviço: "Tag1+Tag2=slug"');
    return 1;
  }
  const [origem, pastaDestino, ...pares] = args;
  const spec = JSON.parse(fs.readFileSync(origem, 'utf-8'));
  fs.mkdirSync(pastaDestino, { recursive: true });

  const disponiveis = new Set();
  for (const metodos of Object.values(spec.paths || {})) {
    for (const [m, op] of Object.entries(metodos)) {
      if (METODOS.includes(m)) for (const t of op.tags || []) disponiveis.add(t);
    }
  }

  let ok = true;
  console.log(`Recortando ${origem}:`);
  for (const par of pares) {
    if (!par.includes('=')) {
      console.log(`  ERRO formato inválido: ${par} (use "Tag=slug")`);
      ok = false;
      continue;
    }
    const idx = par.indexOf('=');
    const tagSpec = par.slice(0, idx);
    const slug = par.slice(idx + 1);
    const tags = tagSpec.split('+');
    const inexistentes = tags.filter((t) => !disponiveis.has(t));
    if (inexistentes.length) {
      console.log(`  ERRO tag inexistente: ${inexistentes.join(', ')}`);
      ok = false;
      continue;
    }
    const novo = recortar(spec, tags);
    let ops = 0;
    for (const v of Object.values(novo.paths)) ops += Object.keys(v).filter((m) => METODOS.includes(m)).length;
    if (ops > LIMITE) console.log(`    AVISO ${ops} operações: acima de ${LIMITE}, considere recortar mais`);
    const arq = path.join(pastaDestino, `openapi-${slug}.json`);
    fs.writeFileSync(arq, JSON.stringify(novo, null, 2) + '\n', 'utf-8');
    const schemas = Object.keys(novo.components?.schemas || {}).length;
    const kb = Math.floor(fs.statSync(arq).size / 1024);
    console.log(`  ${tagSpec}: ${ops} operações, ${schemas} schemas -> openapi-${slug}.json (${kb} KB)`);
  }
  return ok ? 0 : 1;
}

process.exit(main());
