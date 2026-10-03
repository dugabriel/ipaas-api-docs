# BioDoc

Plataforma de reconhecimento facial e auditoria para atendimentos em consultórios, clínicas, laboratórios e hospitais. Autentica beneficiários por biometria facial e fornece ferramentas de auditoria antifraude para operadoras e seguradoras de planos de saúde.

- Documentação: https://docs.biodoc.com.br/ (integração via API: https://docs.biodoc.com.br/api/)
- Spec oficial: **não há** OpenAPI/Swagger publicado — a documentação é textual. As specs desta pasta foram escritas à mão a partir da doc oficial.
- Autenticação: `TOKEN` (Bearer no header `Authorization`)
- Base URL sandbox: `https://api.sandbox.biodoc.com.br/api`
- Base URL produção: `https://api.biodoc.com.br/api`

## Obter o token

A BioDoc envia o token de acesso **depois de cadastrar e liberar a empresa**, um token por ambiente (sandbox e produção). Não há sandbox de autoatendimento: sem a liberação da BioDoc não há como obter credencial nem exercitar a API. O token vai no header `Authorization: Bearer <token>`, que mapeia para o auth model `TOKEN` do iPaaS.

**Não versione o token.** Ele é cadastrado apenas na conta do iPaaS, pela interface. Este `ipaas.json` descreve só o tipo de autenticação.

## Recorte

Três serviços por domínio, 12 operações no total:

| Serviço | Operações | Conteúdo |
|---|---|---|
| `Cartões` (`openapi-cartoes`) | 6 | `GET /card/integration/mainimage`, `POST /card/register`, `POST /card/release`, `POST /card/integration/setnewimage`, `POST /requestnewimage`, `POST /card/integration/deleteMany` |
| `Verificação` (`openapi-verificacao`) | 2 | `POST /card/integration/verify` (Form Data), `POST /integrations/verify` (JSON) |
| `Justificativas e Auditoria` (`openapi-auditoria`) | 4 | `GET /integrations/justify`, `POST /card/integration/justify`, `GET /integrations/log/{reference_Id}`, `GET /logs/external-audits` |

## Decisões de modelagem

**Specs escritas à mão, sem `$ref`.** Como a BioDoc não publica OpenAPI, os schemas foram derivados da tabela de parâmetros/respostas da doc oficial. Tudo foi escrito inline (sem `$ref` entre schemas) porque o importador do iPaaS não resolve `$ref` (seção 4 do playbook). O `dereference.py` não tinha `$ref` a resolver aqui; ainda assim as specs passam por ele para gerar o `.ipaas.json` e rodar a validação do importador (tags, summary, array sem items no requestBody).

**Base URL com dois `servers`.** As specs listam sandbox e produção. No iPaaS o `baseURL` é do ambiente, não da spec, então o cadastro inicial usa **Sandbox**. Para produção, criar outro ambiente com `https://api.biodoc.com.br/api` (mesmo token não vale entre ambientes — a BioDoc emite um por ambiente).

**Todo `requestBody` foi escrito com `items` nos arrays.** O único array de corpo é `idList` em `POST /card/integration/deleteMany`, declarado com `items: { type: string }`. Isso evita a armadilha do playbook em que um `type: array` sem `items` no `requestBody` zera a importação inteira em silêncio.

**`securitySchemes` é `bearer` (header), não query.** Não cai na armadilha do `in: query` que quebra o importador. O importador cria o header a partir do esquema, mas quem injeta o Bearer em execução é a conta `TOKEN` do iPaaS.

## Limitação conhecida do importador (corpo de POST)

Metade das operações é POST com corpo (`card/register`, `verify`, `release`, `setnewimage`, `deleteMany`, `justify`, `requestnewimage`). O importador do iPaaS **não importa o `requestBody`** (seção 4 do playbook): esses recursos entram com os headers/params, mas os campos de corpo **não** aparecem no recurso. Na execução do diagrama, o corpo precisa ser montado à mão em `configurations.inBody`. O `requestBody` nas specs serve de documentação do contrato para quem montar o `inBody`.

Além disso, `POST /card/integration/verify` e `POST /requestnewimage` usam **Form Data** (`multipart/form-data`), não JSON — atenção ao montar o step.

## Como as specs foram geradas

Sem Python nesta máquina (só Node), foi usada uma porta do `dereference.py` em Node:

```bash
node tools/dereference.mjs biodoc
```

O `tools/dereference.mjs` replica o comportamento do `tools/dereference.py` (resolve `$ref`, mescla `allOf`, remove `discriminator` e `securitySchemes` em query, valida os requisitos do importador). Onde houver Python, `python3 tools/dereference.py biodoc` produz o mesmo resultado.

## Status

Importado e validado em diagrama. Cadastrado no tenant `iPaaS Gateway` (produção), ambiente **Sandbox**, 12 recursos em 3 serviços. Diagrama `Valida BioDoc` executado `DONE` (4,1s) com `GET /integrations/justify`. IDs na seção 10 do playbook.

**O que a execução `DONE` provou e o que não provou.** A validação usou `GET /integrations/justify` (leitura, sem efeito colateral) e comprova **cadastro, contrato e autenticação (o token TOKEN) de ponta a ponta**. Ela **não** valida a comparação facial em si: os endpoints de verificação (`/card/integration/verify`, `/integrations/verify`) e de cartão (`/card/register`, `/card/integration/mainimage`) exigem um `idCard` válido no sandbox e uma imagem base64 de rosto real, que não estavam disponíveis nesta sessão. Mesmo que respondessem `2xx`, um `DONE` só confirmaria a chamada aceita, não o acerto biométrico — o mesmo ponto cego dos apps de mensageria (WhatsApp). Para validar o match facial de verdade, é preciso um beneficiário de teste cadastrado e a confirmação do resultado na própria BioDoc.

**Serviços exercitados:** só `Justificativas e Auditoria` (via `justify`). `Cartões` e `Verificação` importaram e conferiram na contagem, mas **não foram executados** por dependerem de dado biométrico de teste.

**`verify` e `requestnewimage` são `multipart/form-data`**, não JSON. Como o importador não traz o corpo, isso não afeta a importação, mas ao montar esses steps no diagrama o corpo vai em `inBody` e **não foi verificado** como o iPaaS trata `multipart/form-data` em execução (o `justify` validado é GET, sem corpo).
