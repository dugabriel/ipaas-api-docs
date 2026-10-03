#!/usr/bin/env python3
"""Gera as versões dereferenciadas das specs OpenAPI para importação no TOTVS iPaaS.

O importador do iPaaS não resolve `$ref`: um response que aponta para
`#/components/schemas/X` é importado como um único campo `response` do tipo
string, em vez dos campos do objeto. Este script resolve `$ref` e mescla
`allOf`, produzindo um `<nome>.ipaas.json` para cada `openapi*.json` da pasta.

Um app pode ter várias specs, uma por serviço:
    asaas/openapi-clientes.json    -> asaas/openapi-clientes.ipaas.json
    asaas/openapi-cobrancas.json   -> asaas/openapi-cobrancas.ipaas.json

Uso:
    python3 tools/dereference.py brasilapi
    python3 tools/dereference.py --all
"""

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
# Conta profundidade de aninhamento, nao de saltos de $ref. Specs grandes e
# legitimamente profundas estouram um limite baixo: a da Meta (WhatsApp) exige
# mais de 40 sem ter um unico ciclo. A protecao contra $ref circular e o
# conjunto `vistos` em dereferenciar(), que e independente deste limite.
LIMITE_PROFUNDIDADE = 200
METODOS = ("get", "post", "put", "delete", "patch", "head", "options")


def resolver_ponteiro(spec, ref):
    """Resolve um JSON pointer local (#/a/b/c)."""
    if not ref.startswith("#/"):
        raise ValueError(f"$ref externo não suportado: {ref}")
    no = spec
    for parte in ref[2:].split("/"):
        parte = parte.replace("~1", "/").replace("~0", "~")
        if parte not in no:
            raise KeyError(f"$ref não resolve: {ref}")
        no = no[parte]
    return no


def mesclar_all_of(partes):
    """Mescla os membros de um allOf em um único schema."""
    resultado = {"type": "object", "properties": {}}
    requeridos = []
    for parte in partes:
        if parte.get("type") and parte["type"] != "object":
            # allOf sobre tipo escalar: usa o último não-objeto
            resultado = dict(parte)
            continue
        resultado["properties"].update(parte.get("properties", {}))
        requeridos.extend(parte.get("required", []))
        for chave in ("description", "example"):
            if chave in parte and chave not in resultado:
                resultado[chave] = parte[chave]
    if requeridos:
        resultado["required"] = sorted(set(requeridos))
    if not resultado.get("properties"):
        resultado.pop("properties", None)
    return resultado


def dereferenciar(no, spec, profundidade=0, vistos=None):
    if profundidade > LIMITE_PROFUNDIDADE:
        raise RecursionError("profundidade excedida: possível $ref circular")
    vistos = vistos or frozenset()

    if isinstance(no, dict):
        if "$ref" in no:
            ref = no["$ref"]
            if ref in vistos:
                raise RecursionError(f"$ref circular: {ref}")
            alvo = resolver_ponteiro(spec, ref)
            resolvido = dereferenciar(alvo, spec, profundidade + 1, vistos | {ref})
            # preserva irmãos do $ref (ex.: description no ponto de uso)
            irmaos = {k: v for k, v in no.items() if k != "$ref"}
            if irmaos:
                resolvido = {**resolvido, **dereferenciar(irmaos, spec, profundidade + 1, vistos)}
            return resolvido

        if "allOf" in no:
            partes = [dereferenciar(p, spec, profundidade + 1, vistos) for p in no["allOf"]]
            mesclado = mesclar_all_of(partes)
            resto = {k: v for k, v in no.items() if k != "allOf"}
            return {**mesclado, **dereferenciar(resto, spec, profundidade + 1, vistos)}

        return {k: dereferenciar(v, spec, profundidade + 1, vistos) for k, v in no.items()}

    if isinstance(no, list):
        return [dereferenciar(i, spec, profundidade + 1, vistos) for i in no]

    return no


def validar_para_ipaas(spec):
    """Checa os requisitos que o importador do iPaaS impõe."""
    problemas = []
    for caminho, metodos in spec.get("paths", {}).items():
        for metodo, op in metodos.items():
            # o path item tambem carrega chaves que nao sao metodo (ex.: `parameters`)
            if metodo not in METODOS:
                continue
            alvo = f"{metodo.upper()} {caminho}"
            if not op.get("tags"):
                problemas.append(f"{alvo}: sem 'tags' — o import falha com HTTP 500")
            if not op.get("summary"):
                problemas.append(f"{alvo}: sem 'summary' — recurso fica sem nome descritivo")
            for onde in arrays_sem_items(op.get("requestBody") or {}):
                problemas.append(
                    f"{alvo}: 'type: array' sem 'items' no requestBody, em {onde}"
                    " — o import responde HTTP 200 e não cria recurso nenhum"
                )
    return problemas


def arrays_sem_items(no, caminho="", out=None):
    """Localiza `type: array` sem `items`.

    `items` é obrigatório em array no OpenAPI 3.0. O importador do iPaaS trata
    a ausência de forma assimétrica, verificado por bissecção:

    - **no `requestBody`**: responde HTTP 200 com corpo vazio e não importa
      **nenhuma** operação da spec. Uma ocorrência derruba o arquivo inteiro,
      não só a operação afetada, e não há mensagem de erro em lugar nenhum. Era
      isso que zerava as 11 operações do serviço de mensagens do WhatsApp
      (`template.components[].parameters`).
    - **em `responses`**: tolerado. O Trello importa as 45 operações de
      `membros` tendo um array sem `items` na resposta de
      `GET /members/{id}/notifications`.

    Por isso só o caso do `requestBody` é reportado como problema.
    """
    if out is None:
        out = []
    if isinstance(no, dict):
        if no.get("type") == "array" and "items" not in no:
            out.append(caminho.lstrip(".") or "(raiz)")
        for k, v in no.items():
            arrays_sem_items(v, caminho + "." + k, out)
    elif isinstance(no, list):
        for i, v in enumerate(no):
            arrays_sem_items(v, f"{caminho}[{i}]", out)
    return out


def remover_esquemas_em_query(spec):
    """Remove securitySchemes com `in: query`, que quebram o importador do iPaaS.

    Verificado por bissecção: declarar um `securityScheme` de `type: apiKey`
    com `in: query` faz o `import-swagger` responder HTTP 500, mesmo que o
    esquema não seja referenciado em `security`. Com `in: header` importa
    normalmente. A autenticação em query continua funcionando em execução,
    porque quem injeta os parâmetros é a conta cadastrada no iPaaS.
    """
    esquemas = (spec.get("components") or {}).get("securitySchemes") or {}
    removidos = [n for n, e in esquemas.items() if isinstance(e, dict) and e.get("in") == "query"]
    if not removidos:
        return []

    for nome in removidos:
        esquemas.pop(nome)
    if not esquemas:
        (spec.get("components") or {}).pop("securitySchemes", None)

    requisitos = []
    for req in spec.get("security") or []:
        resto = {k: v for k, v in req.items() if k not in removidos}
        if resto:
            requisitos.append(resto)
    if requisitos:
        spec["security"] = requisitos
    else:
        spec.pop("security", None)

    return removidos


def remover_discriminators(no):
    """Remove `discriminator`, cujo `mapping` aponta para `components.schemas`.

    A dereferência embute os schemas e descarta `components.schemas`, então o
    `mapping` de um discriminator fica apontando para caminhos que não existem
    mais no documento — OpenAPI inválido e, no caso do importador do iPaaS,
    referência pendurada sem serventia. O `oneOf` ao lado dele continua
    completo, com os membros já expandidos, então nenhuma informação de campo
    se perde. Apareceu primeiro na spec da Meta (WhatsApp): `Message` é um
    `oneOf` de onze tipos de mensagem discriminados por `type`.
    """
    if isinstance(no, dict):
        return {k: remover_discriminators(v) for k, v in no.items() if k != "discriminator"}
    if isinstance(no, list):
        return [remover_discriminators(i) for i in no]
    return no


def colapsar_one_of(no):
    """Colapsa `oneOf`/`anyOf` em um único schema.

    Verificado no Mailchimp: um `oneOf` de 41 membros (tipos de condição de
    segmento), aninhado fundo na resposta de `GET /lists` e `GET /campaigns`,
    faz o `import-swagger` responder HTTP 200 e criar **zero** recurso — a spec
    inteira do serviço não importa, sem mensagem de erro (mesmo padrão
    silencioso do array sem items). Os serviços sem esse construto (Relatórios,
    Templates) importaram normalmente.

    O iPaaS não usa a discriminação ao mapear campos, então unir os membros num
    objeto (união das properties) preserva os campos e remove o ramo profundo
    que quebra o importador. Membros escalares ou mistos caem no primeiro
    membro. Roda após a dereferência (membros já expandidos) e após remover
    discriminator (o `mapping` já saiu).
    """
    if isinstance(no, list):
        return [colapsar_one_of(i) for i in no]
    if isinstance(no, dict):
        atual = no
        for chave in ("oneOf", "anyOf"):
            if isinstance(atual.get(chave), list):
                membros = [colapsar_one_of(m) for m in atual[chave]]
                resto = {k: v for k, v in atual.items() if k != chave}
                objetos = [m for m in membros
                           if isinstance(m, dict) and (m.get("properties") or m.get("type") == "object")]
                if objetos:
                    props = {}
                    req = []
                    for m in objetos:
                        props.update(m.get("properties", {}))
                        req.extend(m.get("required", []))
                    uniao = {"type": "object"}
                    if props:
                        uniao["properties"] = props
                    if req:
                        uniao["required"] = sorted(set(req))
                    atual = {**uniao, **resto}
                else:
                    atual = {**(membros[0] if membros else {}), **resto}
        return {k: colapsar_one_of(v) for k, v in atual.items()}
    return no


def processar(pasta: Path):
    """Processa todas as specs fonte da pasta (openapi.json e openapi-*.json)."""
    origens = sorted(
        f for f in pasta.glob("openapi*.json")
        if not f.name.endswith(".ipaas.json")
    )
    if not origens:
        print(f"  ignorado: {pasta.name} (sem openapi*.json)")
        return True

    ok = True
    for origem in origens:
        spec = json.loads(origem.read_text(encoding="utf-8"))

        plano = dereferenciar(spec, spec)
        plano = remover_discriminators(plano)
        plano = colapsar_one_of(plano)
        # valida o plano, nao a fonte: na fonte os schemas estao atras de $ref e
        # uma checagem estrutural (ex.: array sem items) nao os alcanca
        problemas = validar_para_ipaas(plano)
        em_query = remover_esquemas_em_query(plano)
        if em_query:
            print(f"    securitySchemes em query removidos: {', '.join(em_query)}"
                  " (quebram o importador; a conta do iPaaS injeta os parâmetros)")
        # remove apenas o que foi embutido inline; securitySchemes descreve a
        # autenticação e nao e schema de dados, entao permanece
        componentes = plano.get("components") or {}
        seguranca = componentes.get("securitySchemes")
        if seguranca:
            plano["components"] = {"securitySchemes": seguranca}
        else:
            plano.pop("components", None)

        if json.dumps(plano, ensure_ascii=False).count('"$ref"'):
            problemas.append("ainda restam $ref após a dereferência")
        pendurados = json.dumps(plano, ensure_ascii=False).count("#/components/schemas/")
        if pendurados:
            problemas.append(
                f"{pendurados} referências penduradas a '#/components/schemas/' em strings"
                " (não são $ref, então passam pela checagem acima)"
            )

        destino = pasta / (origem.stem + ".ipaas.json")
        destino.write_text(json.dumps(plano, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        ops = sum(
            len([m for m in metodos if m in ("get", "post", "put", "delete", "patch")])
            for metodos in plano.get("paths", {}).values()
        )
        kb = destino.stat().st_size // 1024
        print(f"  {pasta.name}/{origem.name}: {ops} operações -> {destino.name} ({kb} KB)")
        for p in problemas:
            print(f"    AVISO {p}")
        ok = ok and not problemas
    return ok


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 1

    if args == ["--all"]:
        pastas = sorted(
            d for d in RAIZ.iterdir()
            if d.is_dir() and not d.name.startswith((".", "_")) and d.name != "tools"
        )
    else:
        pastas = [RAIZ / a for a in args]

    ok = True
    print("Gerando specs para o iPaaS:")
    for pasta in pastas:
        if not pasta.is_dir():
            print(f"  ERRO {pasta.name}: pasta não encontrada")
            ok = False
            continue
        ok = processar(pasta) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
