# Mailchimp

Plataforma de marketing e automação (Marketing API v3): audiências e contatos, campanhas de e-mail, relatórios, automações e templates. Boa candidata para o catálogo: autenticação simples (**HTTP Basic** com a API key), plano gratuito e **especificação oficial publicada** pelo fornecedor.

- Documentação: https://mailchimp.com/developer/marketing/api/
- Spec oficial: `https://github.com/mailchimp/mailchimp-client-lib-codegen/blob/main/spec/marketing.json` (repo oficial que gera os SDKs do Mailchimp)
  - Raw: `https://raw.githubusercontent.com/mailchimp/mailchimp-client-lib-codegen/main/spec/marketing.json`
- Autenticação: `BASIC` — `username` pode ser qualquer string, `password` é a API key. (Também há OAuth2 para apps multi-conta; aqui usamos a API key, mais simples.)

Primeiro app do repositório com o modelo de auth **`BASIC`** — fecha o padrão que faltava exercitar (playbook, seção 11).

## Data center no base URL

O host do Mailchimp é **específico da conta**: `https://{dc}.api.mailchimp.com/3.0`, onde `{dc}` é o **data center**, o sufixo da API key depois do último hífen. Uma chave terminada em `-us14` usa o host `us14.api.mailchimp.com`.

O `host` da spec oficial (`server.api.mailchimp.com`) é um **placeholder e não resolve DNS** — tem que ser trocado pelo `{dc}` real. Como o `baseURL` fica no ambiente do iPaaS, basta descobrir o data center (pelo sufixo da chave) e cadastrar o host concreto:

| Ambiente | Base URL |
|---|---|
| Produção | `https://{dc}.api.mailchimp.com/3.0` (ex.: `https://us14.api.mailchimp.com/3.0`) |

Não há sandbox separado no Mailchimp — a conta é uma só. Para validar escrita sem efeito, prefira operações de leitura ou recursos descartáveis (uma lista/segmento de teste).

## Obter a chave de API

1. Crie/entre em uma conta em https://mailchimp.com (o plano gratuito serve para testar).
2. Gere a chave em **Account & billing → Extras → API keys**: https://us1.admin.mailchimp.com/account/api/ (o subdomínio muda conforme seu data center).
3. A chave é usada como **senha** no HTTP Basic; o usuário pode ser qualquer string.

Não versione a chave neste repositório. O `ipaas.json` descreve apenas o formato da autenticação.

## Cadastro no iPaaS

### 1. Aplicativo

| Campo | Valor |
|---|---|
| Nome | `Mailchimp` |
| Descrição | Plataforma de marketing e automação: audiências e contatos, campanhas de e-mail, relatórios, automações e templates. |

### 2. Ambiente

| Campo | Valor |
|---|---|
| Nome | `Produção` |
| Tipo | `REST` |
| Base path | `https://{dc}.api.mailchimp.com/3.0` (substitua `{dc}`) |
| Autenticação | `BASIC` |

Os paths das specs são relativos (`/lists`, `/campaigns`, `/ping`), então o `/3.0` fica no base path do ambiente.

### 3. Conta

Obrigatória — sem ela as chamadas retornam 401.

| Campo | Valor |
|---|---|
| Nome | `Produção` |
| Tipo de autenticação | `BASIC` |
| Usuário | qualquer string (ex.: `mailchimp`) |
| Senha | sua API key |

### 4. Serviços e importação

Seis serviços, um por domínio:

| Serviço | Operações | Spec |
|---|---|---|
| `Audiências` | 70 | `openapi-audiencias.ipaas.json` |
| `Campanhas` | 22 | `openapi-campanhas.ipaas.json` |
| `Relatórios` | 22 | `openapi-relatorios.ipaas.json` |
| `Automações` | 18 | `openapi-automacoes.ipaas.json` |
| `Templates` | 6 | `openapi-templates.ipaas.json` |
| `Conta e Ping` | 2 | `openapi-conta.ipaas.json` |

URLs de importação (troque `main` pelo SHA do commit para evitar o cache do raw):

```
https://raw.githubusercontent.com/dugabriel/ipaas-api-docs/main/mailchimp/openapi-audiencias.ipaas.json
https://raw.githubusercontent.com/dugabriel/ipaas-api-docs/main/mailchimp/openapi-campanhas.ipaas.json
https://raw.githubusercontent.com/dugabriel/ipaas-api-docs/main/mailchimp/openapi-relatorios.ipaas.json
https://raw.githubusercontent.com/dugabriel/ipaas-api-docs/main/mailchimp/openapi-automacoes.ipaas.json
https://raw.githubusercontent.com/dugabriel/ipaas-api-docs/main/mailchimp/openapi-templates.ipaas.json
https://raw.githubusercontent.com/dugabriel/ipaas-api-docs/main/mailchimp/openapi-conta.ipaas.json
```

As URLs acima apontam para `dugabriel/.../main` e valem **após o merge** do PR. A validação desta sessão foi feita a partir do fork `HugoHSevero/ipaas-api-docs` (branch `add-mailchimp`), importando por SHA — mesmo esquema que o Open-Meteo usou enquanto o PR não era mergeado:

```
https://raw.githubusercontent.com/HugoHSevero/ipaas-api-docs/40304e606ed85946a3bc4d65364a23ab2f843113/mailchimp/openapi-<slug>.ipaas.json
```

O serviço `Audiências` tem 70 operações, acima do limite de 60 sugerido pelo `slice_spec`. Foi mantido inteiro porque a tag `lists` do Mailchimp concentra tudo (membros, tags, segmentos, merge fields) em `lists/{list_id}/...` e dividir divergiria da tag oficial. O importador suporta o volume; o custo é uma lista mais longa na interface.

## Como as specs foram geradas

A spec oficial está em **Swagger 2.0** (`swagger: "2.0"`, `info.version: 3.0.91`), e o importador do iPaaS só aceita OpenAPI 3 — mesmo caso da Brevo. Além disso, esta máquina **não tem Python**, só Node, então o fluxo usa as portas em Node dos scripts (`dereference.mjs` já existia; `slice_spec.mjs` foi criada nesta sessão).

```bash
# 1. baixar a spec oficial (baixa anônima, repo público)
curl -sL "https://raw.githubusercontent.com/mailchimp/mailchimp-client-lib-codegen/main/spec/marketing.json" -o mailchimp/_marketing_source.json

# 2. normalizar `type: ["string","integer"]` -> `type: "string"`
#    (8 ocorrências em variant_ids de ecommerce; o swagger2openapi rejeita type-array,
#     mesmo em spec Swagger 2.0, com "schema type must not be an array")

# 3. converter Swagger 2.0 -> OpenAPI 3.0.3
npx -y swagger2openapi@7 --outfile mailchimp/_marketing_oas3.json --targetVersion 3.0.3 mailchimp/_marketing_source_norm.json

# 4. recortar por tag (port Node do slice_spec.py, para máquina sem Python)
node tools/slice_spec.mjs mailchimp/_marketing_oas3.json mailchimp \
    "lists=audiencias" \
    "campaigns=campanhas" \
    "reports=relatorios" \
    "automations=automacoes" \
    "templates=templates" \
    "root+ping=conta"

# 5. dereferenciar / validar requisitos do importador (port Node do dereference.py)
node tools/dereference.mjs mailchimp
```

O `dereference.mjs` não emitiu nenhum aviso: as 140 operações têm `tags` e `summary`, não há `type: array` sem `items` no `requestBody` e não sobrou `$ref`.

**Duas descobertas custaram tempo aqui (registradas no playbook, seção 4):**

1. **`swagger2openapi` rejeita `type` como array.** A spec, apesar de `swagger: "2.0"`, tem 8 esquemas com `type: ["string","integer"]` (todos em `variant_ids` de `ecommerce`). A conversão falha com `schema type must not be an array` até esses serem colapsados para um tipo único (passo 2).

2. **Um `oneOf` grande e profundo em resposta zera o import em silêncio.** As respostas de `GET /lists` e `GET /campaigns` trazem `segment_opts.conditions` como um `oneOf` de **41 membros** (os tipos de condição de segmento). Com ele, o `import-swagger` responde **HTTP 200 e cria zero recursos** — a spec inteira do serviço não importa, sem mensagem de erro nenhuma. Os serviços sem esse construto (Relatórios, Templates, Conta) importaram de primeira. A correção foi um passo novo no `dereference` (`.mjs` e `.py`) que **colapsa `oneOf`/`anyOf`** unindo os membros num objeto; depois disso os 6 serviços importaram 140/140.

## Validação

Validado em diagrama (`Valida Mailchimp`, projeto `Validação apps`): 5 steps em série, todos de **leitura**, cobrindo 5 dos 6 serviços. Execução `DONE` em **3,6s**, com os payloads reais agregados na resposta síncrona.

| Step | Operação | Serviço | Resultado |
|---|---|---|---|
| 1 | `GET /ping` | Conta e Ping | `health_status: "Everything's Chimpy!"` |
| 2 | `GET /` | Conta e Ping | dados da conta (`role: owner`, `pricing_plan_type: forever_free`) |
| 3 | `GET /lists` | Audiências | audiências da conta |
| 4 | `GET /campaigns` | Campanhas | campanhas da conta |
| 5 | `GET /reports` | Relatórios | relatórios de campanhas |

O `DONE` com `finalComponent` no nó de resposta prova que os 5 steps executaram — valida **cadastro, contrato e a autenticação `BASIC`** contra a API real. O `GET /ping` respondendo também confirma que o data center (`us1`) e a credencial estão corretos (a tentativa de chamar a Mailchimp direto do navegador dá `Failed to fetch` por CORS, não é conclusiva; a execução no iPaaS é a prova).

### O que não foi validado em execução

- **Operações de escrita** (criar lista, criar campanha). O importador do iPaaS **não traz o corpo de POST/PUT** (playbook, seção 4), então escrita precisa do corpo montado em `configurations.inBody` no diagrama. Não foi exercitado.
- Os serviços **Templates** e **Automações** não entraram no diagrama de validação; estão importados e conferidos por contagem e schema, mas não foram executados.

## Domínios ainda não importados

O recorte atual cobre marketing de e-mail e audiências. Os demais domínios da spec oficial, por volume de operações:

`ecommerce` (60), `reporting` (12), `fileManager` (11), `sms-campaigns` (10), `contacts` (8), `landingPages` (8), `connectedSites` (7), `batchWebhooks` (5), `templateFolders` (5), `campaignFolders` (5), `verifiedDomains` (5), `audiences` BETA (4), `batches` (4), `conversations` (4), `Surveys` (3), `accountExports` (2), `authorizedApps` (2), `facebookAds` (2), `activityFeed` (1), `customerJourneys` (1), `searchCampaigns` (1), `searchMembers` (1).

Para adicionar qualquer um, inclua o par `"Tag=slug"` no comando de recorte e crie o serviço correspondente.

**Atenção ao `ecommerce`:** as 8 operações com `type: ["string","integer"]` em `variant_ids` estão nesse domínio. Antes de recortá-lo, rode a normalização (passo 2 acima) ou o `swagger2openapi` vai falhar com `schema type must not be an array`.

## Observações

Os schemas vêm da **spec oficial do fornecedor**, convertida de Swagger 2.0. Após a conversão, o Mailchimp declara os schemas **inline** (não via `$ref` para `components/schemas`), então os arquivos recortados são grandes (a `Audiências` passa de 2,8 MB) e o `dereference` tem pouco a resolver — mas ainda valida os requisitos do importador.

Parâmetros de query do tipo `array` (como `fields` e `exclude_fields`) importam com o tipo do elemento em branco (`itemType: null`), conforme a seção 4 do playbook. São opcionais e o valor vai como texto separado por vírgula na query, então não impedem a execução; foram mantidos como na spec oficial.
