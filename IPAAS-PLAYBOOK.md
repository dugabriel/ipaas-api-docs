# Playbook - Cadastro de apps no TOTVS iPaaS

Referência operacional para cadastrar um novo app de mercado no iPaaS. Contém a API real, os payloads que funcionam, as armadilhas já descobertas e o checklist de validação.

Tudo marcado como **verificado** foi executado com sucesso. O que ainda não foi exercitado está marcado como **não verificado** — trate como hipótese, não como fato.

---

## 0. Arranque rápido

Se você está começando uma sessão nova, siga esta ordem. O prompt inicial pronto para colar está no [README](./README.md#prompt-inicial).

1. **Leia as seções 1, 2 e 4.** São o essencial: contexto, sequência de cadastro e as armadilhas do importador. As seções 3 (auth models), 8 (endpoints) e 10 (estado atual) são consulta.

2. **Abra o navegador e garanta a sessão.** Todas as chamadas de API saem de dentro da página autenticada, usando o token do cookie (seção 1) — sem isso, nada funciona.

   - **Confira que o MCP do Chrome está no ar** antes de qualquer coisa. O cadastro depende dele: o token vem do cookie de uma página logada e diagrama novo só nasce pela interface (seção 6.2). A configuração está no [README](./README.md#pré-requisito-mcp-do-chrome). Em desktop Linux, use `--autoConnect` e habilite o Remote Debugging em `chrome://inspect/#remote-debugging`; sem isso o servidor tenta lançar o próprio Chrome e falha com `Missing X server to start the headful browser` (verificado em Ubuntu 26.04 / Wayland).
   - Abra `https://ipaas.totvs.app`. O iPaaS redireciona para o TOTVS Identity (`app.fluigidentity.com/ui/login`).
   - **Peça ao usuário para logar e espere a confirmação dele.** Não tente automatizar SSO/MFA, não leia credenciais de arquivo e não preencha o formulário de login.
   - Depois da confirmação, valide a sessão com uma **chamada real à API**, não pela URL da página:

   ```js
   const m = document.cookie.match(/(?:^|;\s*)jwt\.token=([^;]+)/);
   // sem match: a sessão não subiu; peça login de novo em vez de seguir
   const r = await fetch('https://api-ipaas.totvs.app/ipaas/api/v2/auth-models?page=1&pageSize=1',
     { headers: { authorization: 'Bearer ' + m[1], accept: 'application/json' } });
   r.status; // 200 = sessão boa
   ```

   O token vale cerca de 48 horas. Se começar a dar 401 no meio da sessão, é ele — peça um novo login.

3. **Confirme em qual tenant está trabalhando e diga ao usuário.** O tenant usado até agora é **produção** (`iPaaS Gateway`). O nome aparece no cabeçalho da interface e no campo `ownerTenantName` dos apps criados por nós:

   ```
   GET /ipaas/api/v3/applications?page=1&pageSize=9999
   ```

   Nesse mesmo GET dá para ver se o app é nosso (`isCustom: true`, `ownerTenantName` do nosso tenant) ou do catálogo TOTVS (`isCustom: false`). Escrever em app de outro tenant é possível pela API, mas as implicações não foram verificadas — ver seção 10.

4. **Confirme por GET o que já existe antes de criar qualquer coisa.** A seção 10 tem o estado levantado, mas o tenant é compartilhado e pode ter mudado. Vale para app, ambiente, conta e serviço.

5. **Escolha o próximo app na fila da seção 11** ou siga o que o usuário pedir.

6. **Siga a receita da seção 5.**

7. **Ao terminar, atualize a documentação.** Seção 9 (histórico), seção 10 (IDs do que foi criado), seção 11 (fila) e o `README.md` da pasta do app. Registre também o que **falhou** e o que **não deu para verificar** — é o que economiza tempo na sessão seguinte.

Comandos do repositório:

```bash
python3 tools/tag_by_path.py <spec-origem> <spec-destino> "segmento=Tag" ...  # injeta tags quando a spec nao tem
python3 tools/slice_spec.py <spec-origem> <app> "Tag=slug" ...   # recorta spec grande por tag
python3 tools/dereference.py <app>                                # gera os *.ipaas.json
python3 tools/dereference.py --all
```

Em máquina **sem Python** (só Node), use as portas equivalentes — mesmo comportamento:

```bash
node tools/slice_spec.mjs <spec-origem> <app> "Tag=slug" ...    # aceita "Tag1+Tag2=slug" para juntar tags num serviço
node tools/dereference.mjs <app>                                 # ou --all
```

(`tag_by_path.py` ainda não tem porta em Node; se precisar retaguear numa máquina sem Python, resolva à parte.)

Regras que evitam a maior parte do retrabalho:

- **Nunca fixe `diagramId`.** Cada save cria nova revisão; sempre leia com `lastVersion=true` (seção 6.4).
- **Não confie no `testAccount`** para validar credencial (seção 2.3).
- **O corpo de POST/PUT não vem na importação**; use `configurations.inBody` no diagrama (seções 4 e 6.1).
- **Diagrama novo só nasce pela interface**; não existe POST para criar integração (seção 6.2).
- **HTTP 500 na importação tem duas causas comuns e a mesma mensagem**: falta de `tags` ou `securitySchemes` com `in: query` (seção 4).
- **Peça a credencial ao usuário na etapa da conta** e lembre de rotacionar depois. Nunca versione.
- **Valide executando o diagrama**, não só importando.

---

## 1. Contexto do ambiente

| Item | Valor |
|---|---|
| Front-end | `https://ipaas.totvs.app` |
| API | `https://api-ipaas.totvs.app` |
| Tenant usado | `iPaaS Gateway` (produção) |
| Repositório de specs | `github.com/dugabriel/ipaas-api-docs` (público) |

### Autenticação da API

O token JWT da sessão do navegador serve como Bearer nas chamadas. Ele está no cookie `jwt.token` e vale cerca de 48 horas.

```js
const token = document.cookie.match(/(?:^|;\s*)jwt\.token=([^;]+)/)[1];
const headers = {
  authorization: 'Bearer ' + token,
  accept: 'application/json',
  'content-type': 'application/json'
};
```

Executar as chamadas de dentro da página autenticada evita lidar com login, SSO e MFA. Não é necessário extrair nem armazenar a credencial em nenhum lugar.

---

## 2. Sequência de cadastro

```
Aplicativo → Ambiente → [Conta] → Serviço → Importar Swagger → Validar
```

A conta é dispensável quando o ambiente usa `NO_AUTH` (verificado na BrasilAPI).

### 2.1 Criar o aplicativo — verificado

`POST /ipaas/api/v3/applications` → **201**

```json
{
  "name": "BrasilAPI",
  "description": "Dados públicos brasileiros: CEP, CNPJ, bancos..."
}
```

A resposta traz o id no campo **`componentId`**, não `id`. É esse valor que os passos seguintes usam como `applicationId`.

Não envie `category`: o endpoint `/v4/applications/categories` retorna 404 e nenhum dos 70 apps do tenant usa esse campo.

### 2.2 Criar o ambiente — verificado

`POST /ipaas/api/v2/environments` → **200**

```json
{
  "name": "Produção",
  "type": "REST",
  "baseURL": "https://brasilapi.com.br/api",
  "applicationId": "<componentId do app>",
  "authModelIds": ["d6a952f5-7ce3-44e4-af8e-8697c3ef4b37"],
  "active": true
}
```

O campo de vínculo é **`authModelIds`** (lista de IDs). Enviar `authModels` com objetos é aceito sem erro e **não vincula nada** — o ambiente fica silenciosamente sem autenticação.

`baseURL` sem barra no final. Se os paths da spec já incluem prefixo de versão (o Asaas usa `/v3/...`), o base path **não** deve repetir esse prefixo.

A resposta do POST devolve `active: false` mesmo quando você envia `true`. É só o retorno; um GET seguido mostra `active: true`. Não tente "corrigir".

Para editar depois: `PUT /ipaas/api/v2/environments/{id}` com o mesmo corpo.

#### Ambiente custom para alternar sandbox e produção

Quando a API tem ambientes que só diferem no subdomínio, em vez de criar dois ambientes irmãos (o que obrigaria a duplicar os serviços), use um **ambiente custom** com placeholder e ambientes filhos:

```
ambiente pai   custom: true   baseURL: https://{environment}.asaas.com
  └── filho    Sandbox        baseURL: https://api-sandbox.asaas.com
  └── filho    Produção       baseURL: https://api.asaas.com
```

Os serviços ficam vinculados ao **pai**, então trocar de ambiente não exige recriar nem reimportar nada. Os filhos aparecem em `environmentsChild` ao expandir o ambiente. Consulta:

```
GET /ipaas/api/v2/environments/?applicationId={id}&expand=environmentsChild&expand=authModels&expand=accounts
```

O ambiente custom do Asaas foi criado **pela interface**, não pela API. O payload para criar um custom com filhos via API **não foi verificado** — provavelmente envolve `custom: true` no pai e algum vínculo de parent nos filhos, mas não teste isso em cima de um ambiente que já tem serviços importados. Se precisar de ambiente custom, o caminho seguro hoje é pedir ao usuário para criar pela interface e depois ler os ids com o GET acima.

### 2.3 Criar a conta — verificado

`POST /ipaas/api/v3/accounts` → **201**

```json
{
  "authType": "API_KEY",
  "componentId": "<componentId do app>",
  "environmentId": "<id do ambiente>",
  "name": "Sandbox",
  "modelId": "e90e6f18-c1bb-4170-9d10-5e45be5314c6",
  "config": {
    "outputSchema": {
      "addTo": "header",
      "keys": [{ "key": "access_token", "value": "<credencial>" }]
    }
  }
}
```

Pontos que custam tempo se errados:

`environmentId` é **string**, não lista. Enviar `environments: [{ "id": ... }]` (o formato que aparece na **leitura** da conta) resulta em `500 Name is null`, mensagem que não tem relação com a causa.

`authType` é obrigatório além de `modelId`. Os dois se referem ao mesmo auth model: `authType` é o tipo (`API_KEY`) e `modelId` é o id.

Os valores da credencial vão em `config.outputSchema`, com as chaves do `inputSchema` do auth model (seção 3). Para `API_KEY`: `addTo` (`header` ou `query`) e `keys` como lista de pares.

Ao vincular a conta a um ambiente **custom**, ela passa a valer também para os ambientes filhos.

#### Payload para `TOKEN` — verificado

O `config.outputSchema` segue o `inputSchema` do auth model, que para `TOKEN` tem uma única chave `token`:

```json
{
  "authType": "TOKEN",
  "componentId": "<componentId do app>",
  "environmentId": "<id do ambiente>",
  "name": "Produção",
  "modelId": "3ce568bb-e05a-4186-b650-9faa63c46041",
  "config": { "outputSchema": { "token": "<token>" } }
}
```

→ **201**. Verificado no WhatsApp (seção 10). Confirme a gravação pela listagem: o `config.outputSchema.token` volta preenchido e a conta aparece em `accounts` ao expandir o ambiente.

#### Não existe GET de conta individual

`GET /ipaas/api/v3/accounts/{id}` responde **500** com `FLUIG_CORE_000` e `Request method 'GET' is not supported` — a rota existe só para escrita. Para ler uma conta, use a listagem filtrada:

```
GET /ipaas/api/v3/accounts?componentId={appId}&page=1&pageSize=100
```

Ou expanda pelo ambiente, que traz as contas junto com o `inputSchema` do auth model — útil para descobrir as chaves que o `outputSchema` precisa:

```
GET /ipaas/api/v2/environments/?applicationId={appId}&expand=accounts&expand=authModels
```

Para atualizar a credencial depois (troca de token, rotação): `PUT /ipaas/api/v3/accounts/{id}`.

**O `PUT` sem `active: true` desativa a conta.** O campo não é preservado: omiti-lo grava `active: false`, e aqui não é só o retorno — a listagem confirma `false`. Uma conta inativa não autentica os steps do diagrama. Mande o corpo completo, com `active: true` explícito:

```json
{
  "authType": "TOKEN",
  "componentId": "<componentId do app>",
  "environmentId": "<id do ambiente>",
  "name": "Produção",
  "modelId": "<id do auth model>",
  "active": true,
  "config": { "outputSchema": { "token": "<token>" } }
}
```

Depois de qualquer `PUT`, confira `active` na listagem antes de executar. Aconteceu aqui ao trocar o token do WhatsApp: o `PUT` respondeu 200, gravou o token certo e deixou a conta desativada.

#### testAccount tem uso limitado

`GET /ipaas/api/v3/accounts/testAccount/{id}` **não funciona para `API_KEY` sem parâmetro**: retorna `400 FLUIG_CONNECTOR_ACCOUNT_TEST_URL_NEEDED` com o tipo de auth em `args`. Com `?authUrl=<url>` ele passa a chamar a URL, mas retornou `500 / "400 Bad Request"` mesmo com credencial comprovadamente válida (a mesma chave respondia `200` via curl e funcionou na execução do diagrama).

Ou seja: **não use o `testAccount` como critério de validação da credencial.** Valide chamando a API do fornecedor diretamente e, principalmente, executando o diagrama.

### 2.4 Criar o serviço — verificado

`POST /ipaas/api/v3/application-services` → **201**

```json
{
  "name": "Dados Públicos",
  "description": "Consultas de CEP, CNPJ, bancos...",
  "applicationId": "<componentId do app>",
  "environmentId": "<id do ambiente>",
  "resourceType": "REST",
  "icon": "product"
}
```

Ícones vistos em uso: `product`, `light-bulb`, `adb`. A lista completa de valores válidos não foi levantada.

Para remover um serviço: `DELETE /ipaas/api/v3/application-services/{id}` → **204** com corpo vazio — verificado, inclusive em serviço que já tinha recursos importados. Útil para limpar serviços de teste; a bissecção desta sessão criou 56 deles e todos saíram por aqui.

### 2.5 Importar o Swagger — verificado

`POST /ipaas/api/v3/rest-resources/import-swagger` → **200** com corpo vazio

```json
{
  "applicationId": "<componentId do app>",
  "serviceId": "<id do serviço>",
  "endPoint": "https://raw.githubusercontent.com/.../openapi.ipaas.json",
  "swaggerEndPoint": "https://raw.githubusercontent.com/.../openapi.ipaas.json",
  "update": true
}
```

O campo obrigatório é **`swaggerEndPoint`**. Omiti-lo retorna 400 com `NotEmpty` apontando o campo. Mande `endPoint` com o mesmo valor, que é o que o front faz.

Sucesso é **200 com corpo vazio** — não há resumo do que foi importado. Só a listagem de recursos confirma o resultado.

Para SOAP o equivalente é `POST /ipaas/api/v3/soap-resources/import-wsdl` com `soapEndPoint` (não verificado).

### 2.6 Validar — verificado

```
GET /ipaas/api/v3/rest-resources?serviceId={id}&fields=id&fields=name&page=1&pageSize=9999
GET /ipaas/api/v3/resources?serviceId={id}&id={resourceId}&expand=properties&expand=model
```

Confira: a contagem de recursos bate com a de operações da spec, e `properties.responseBody.restResourceBodyObjects` tem os campos do objeto — e não um único `response` do tipo string, que é o sintoma de `$ref` não resolvido.

---

## 3. Modelos de autenticação

IDs globais do tenant, iguais para qualquer app. Consulta: `GET /ipaas/api/v2/auth-models?page=1&pageSize=999`.

| Tipo | ID | Campos (\* = obrigatório) |
|---|---|---|
| `NO_AUTH` | `d6a952f5-7ce3-44e4-af8e-8697c3ef4b37` | — |
| `BASIC` | `4a4d0fa1-2933-438d-a6ac-36432bc2cf42` | `username*`, `password*` |
| `TOKEN` | `3ce568bb-e05a-4186-b650-9faa63c46041` | `token*` |
| `API_KEY` | `e90e6f18-c1bb-4170-9d10-5e45be5314c6` | `addTo*` (`header`/`query`), `keys` (lista de `key`/`value`) |
| `OAUTH1` | `e5e4bb18-0f2b-4e3e-be33-412fab6a6b2b` | `consumerKey*`, `consumerSecret*`, `accessToken*`, `tokenSecret*` |
| `OAUTH2_CLIENT` | `45ff3eb3-111f-4a35-b665-579519a1c87e` | `accessTokenURL*`, `client_id*`, `client_secret*`, `clientAuth*`, `scope`, `grant_type` |
| `OAUTH2_PASSWORD` | `9afef6ed-83f3-4293-ba3a-37bf6df6d8cf` | `accessTokenURL*`, `username*`, `password*`, `client_id*`, `client_secret*`, `clientAuth*` |
| `OAUTH2_CODE` | `158e40cb-53b4-4381-95a7-4857b7156019` | `authURL*`, `accessTokenURL*`, `code*`, `client_id*`, `client_secret*`, `clientAuth*` |
| `NTLM` | `0d5bba8e-d15e-4cb6-bfd4-7904fbb8cb61` | `username*`, `password*`, `domain`, `workstation` |
| `AWS_SIGNATURE` | `240ecfed-628f-436b-be67-5e8984bfcf39` | `accessKey*`, `secretKey*`, `awsRegion*`, `serviceName*`, `sessionToken` |

`clientAuth` aceita `header` (Basic Auth header) ou `body` (credenciais no corpo).

**Não existe modelo para credenciais no corpo da requisição.** Isso inviabiliza apps como o **Omie**, que manda `app_key` e `app_secret` no body de cada chamada. Ficam de fora até haver uma abordagem específica.

Priorize apps `NO_AUTH`, `BASIC`, `TOKEN` e `API_KEY`. Os fluxos OAuth2 authorization code exigem interação de navegador para obter o `code` e não são automatizáveis em lote — caso do **Bling v3**.

---

## 4. Requisitos e armadilhas do importador

Todos verificados na prática. Nenhum está documentado publicamente.

**`tags` é obrigatório em toda operação.** Sem `tags`, a importação falha com HTTP 500 e `FLUIG_CONNECTOR_IMPORT_SWAGGER_500`, sem indicar a causa. Confirmado por bissecção: a mesma spec sem tags dá 500, com tags dá 200.

Nem toda spec oficial tem tags: a do Trello publica **261 operações sem nenhuma tag**, o que além de quebrar a importação impede o recorte por domínio. `tools/tag_by_path.py` deriva a tag do primeiro segmento do path (`/boards/{id}/lists` → `boards`), com renomeação opcional para o nome ficar legível na interface.

**`$ref` não é resolvido.** Response apontando para `#/components/schemas/X` é importado como um único campo `response` do tipo string e os campos do objeto se perdem. Vale para objetos e arrays de objetos. Solução: `tools/dereference.py`.

**`allOf` também precisa ser resolvido.** Mesmo motivo; o script mescla os membros.

**O nome do recurso é `{MÉTODO} - {tag} - {path} - {summary}`.** O `operationId` é ignorado. `tags` e `summary` são o que determina a legibilidade da lista na interface.

**`number` pode virar `string`.** Um campo `number` foi importado como `string`; `integer` foi preservado. Prefira `integer` para valores inteiros.

**Parâmetro de query `type: array` fica sem o tipo do elemento.** O importador não captura o `items.type` de parâmetros de query do tipo array — o parâmetro entra com `type: array` e `itemType: null`, e na interface o tipo do elemento aparece em branco. Verificado no Open-Meteo, cujos parâmetros como `hourly`/`daily` são `array` de `enum` de `string`. Solução: se a API aceita **lista separada por vírgula** (caso do Open-Meteo: `hourly=temperature_2m,precipitation`), declare o parâmetro como `type: string` na spec e registre os valores permitidos na `description`. O importador então mostra `string` e a execução funciona igual, porque o valor já vai como texto na query.

**Parâmetros de path viram `{{{param}}}`.** Formato de template do iPaaS, esperado.

**O corpo de POST/PUT não é importado.** O importador traz path, query params, headers e o schema de **resposta**, mas ignora o corpo da requisição. Verificado com spec de teste isolada: um `POST` com `requestBody` (OpenAPI 3) importa com HTTP 200, porém `properties` sai sem `requestBody` e o `inputSchema` contém apenas `inHeader`. Não é problema da spec — é limitação do importador.

Enviar a spec em **Swagger 2.0** (com o corpo em `parameters`/`in: body`) não resolve: o importador quebra com HTTP 500 e `Cannot invoke "java.lang.Throwable.getMessage()" because "cause" is null` (NPE no backend). Só OpenAPI 3 é aceito.

**Spec oficial em Swagger 2.0 se resolve convertendo** — verificado na Brevo, cuja spec oficial é 2.0. A conversão com `swagger2openapi` produziu OpenAPI 3.0.3 limpo, que importou sem erro:

```bash
npx -y swagger2openapi@7 --outfile /tmp/spec_oas3.json --targetVersion 3.0.3 /tmp/spec_swagger2.json
```

Depois disso o fluxo normal (`slice_spec.py` → `dereference.py`) se aplica. Se a spec estiver em YAML, converta para JSON antes, porque os dois scripts do repositório leem JSON.

Consequência prática: para APIs de escrita, o corpo precisa ser montado no builder, recurso por recurso. Existe um conversor que ajuda: `POST /ipaas/api/v3/rest-resources/schemas` recebe um **JSON de exemplo no corpo da requisição** e devolve os campos já no formato interno do iPaaS:

```json
// envio
{ "name": "Cliente", "endereco": { "rua": "Av Paulista", "numero": 1000 } }
// resposta
{ "items": [
  { "key": "name", "label": "name", "type": "string" },
  { "key": "endereco", "label": "endereco", "type": "object", "objects": [
      { "key": "numero", "label": "numero", "type": "integer" },
      { "key": "rua", "label": "rua", "type": "string" } ] } ] }
```

Isso abre caminho para gerar o corpo a partir do schema da spec, mas ainda não foi testado se dá para gravar o resultado no recurso via `PUT`. **Não verificado.**

**`securityScheme` com `in: query` quebra a importação.** Um `securitySchemes` de `type: apiKey` com `in: query` faz o `import-swagger` responder **HTTP 500 `FLUIG_CONNECTOR_IMPORT_SWAGGER_500`** — o mesmo erro genérico da falta de `tags`, o que induz ao diagnóstico errado. Basta **declarar** o esquema: não precisa estar referenciado em `security`.

Verificado por bissecção com a spec do Trello, que declara `key` e `token` em query:

| Variante | Resultado |
|---|---|
| dois esquemas `in: query` | 500 |
| um esquema `in: query` | 500 |
| esquemas `in: query` declarados, `security` ausente | 500 |
| mesmo esquema com `in: header` | 200 |
| sem `securitySchemes` | 200 |

O `dereference.py` remove esses esquemas ao gerar o `.ipaas.json` e avisa no console. Não se perde nada em execução: quem injeta os parâmetros é a conta cadastrada no iPaaS, não a spec.

Diagnóstico prático: quando der 500, cheque **`tags`** primeiro e **`securitySchemes` com `in: query`** em seguida. As duas causas dão a mesma mensagem.

**O `securityScheme` da spec vira header no recurso.** Se a spec declara `securitySchemes` com `in: header` (o Asaas usa `access_token`, a Brevo usa `api-key`), o importador cria esse header no `inputSchema` do recurso, marcado como `sensitiveData: true`. Não conflita com a conta `API_KEY`, que injeta o header em tempo de execução, mas explica por que o campo aparece duplicado na interface.

Consequência prática: **remova das specs os esquemas de segurança opcionais**. A spec da Brevo declara `api-key` e `partner-key`; mantendo os dois, todo recurso importado ganharia um campo `partner-key` que ninguém usa. Deixe em `security`/`securitySchemes` apenas o esquema que a conta vai preencher.

**Cache do `raw.githubusercontent` tem TTL de alguns minutos.** Após um push, a URL de branch pode servir a versão antiga, e query string não contorna. Para importar algo recém-publicado, use a URL por commit SHA, que é imutável:

```
https://raw.githubusercontent.com/dugabriel/ipaas-api-docs/<sha>/<app>/openapi.ipaas.json
```

**O repositório precisa ser público.** O iPaaS baixa a spec anonimamente.

**A importação aceita apenas URL, não upload de arquivo.** É a razão de existir este repositório.

**A importação é assíncrona: `200` não significa que terminou.** O `import-swagger` responde HTTP 200 com corpo vazio e continua processando em segundo plano. Listar os recursos imediatamente devolve **zero** e parece falha. Nos testes o tempo até os recursos aparecerem ficou em torno de **1,9 segundo**, consistente entre specs de 2 KB e 340 KB.

Isso produz falso negativo com facilidade e contamina qualquer bissecção. Faça polling em vez de uma leitura só:

```js
for (let i = 0; i < 10; i++) {
  await new Promise(r => setTimeout(r, 1500));
  const n = (await listarRecursos(serviceId)).length;
  if (n > 0) break;
}
```

Custou várias rodadas de investigação nesta sessão: quatro operações foram diagnosticadas como quebradas e duas delas só estavam sendo medidas cedo demais.

**`type: array` sem `items` no `requestBody` zera a importação inteira, em silêncio.** Responde HTTP 200 com corpo vazio e **não cria recurso nenhum** — nem os das outras operações. Uma única ocorrência derruba o arquivo todo, e não há mensagem de erro em log, corpo ou status.

O comportamento é **assimétrico**, o que engana:

| Onde está o array sem `items` | Resultado |
|---|---|
| `requestBody` | 200 e **zero** recursos na spec inteira |
| `responses` | tolerado, importa normalmente |

Verificado por bissecção com uma spec de uma operação por arquivo: na spec da Meta, `template.components[].parameters` vinha sem `items` e zerava as 11 operações do serviço de mensagens do WhatsApp. O lado tolerado está confirmado pelo Trello, que importa as 45 operações de `membros` tendo um array sem `items` na resposta de `GET /members/{id}/notifications`.

`items` é obrigatório em array no OpenAPI 3.0, então specs oficiais com essa falha não são raras. O `dereference.py` acusa o caso do `requestBody` em `validar_para_ipaas`.

**`oneOf`/`anyOf` grande e profundo em resposta zera a importação, em silêncio.** Mesmo sintoma do array sem `items`: HTTP 200, corpo vazio e **zero recurso** na spec inteira do serviço, sem log nem mensagem. Verificado no Mailchimp: as respostas de `GET /lists` e `GET /campaigns` trazem `segment_opts.conditions` como um `oneOf` de **41 membros** (tipos de condição de segmento), aninhado fundo (profundidade ~25). Com ele, os serviços `Audiências` (70 ops) e `Campanhas` (22) importavam **0**; os serviços sem o construto (`Relatórios`, `Templates`, `Conta`) importavam normalmente. `Automações` tinha um `oneOf` menor e passou — ou seja, não é o `oneOf` em si, é o **tamanho/profundidade** dele que estoura algum limite do importador.

O `dereference` (`.py` e `.mjs`) ganhou um passo `colapsar_one_of`/`colapsarOneOf` que **une os membros do `oneOf`/`anyOf` num único objeto** (união das properties), removendo o ramo profundo. O iPaaS não usa a discriminação ao mapear campos, então nenhum campo se perde. Depois do colapso, os 6 serviços do Mailchimp importaram 140/140. Roda após a dereferência (membros já expandidos) e após remover `discriminator`.

Diagnóstico prático: quando um serviço der 200 com **zero** recurso e a spec passar na checagem de `tags`/`array sem items`, suspeite de um `oneOf`/`anyOf` grande e profundo em resposta. Um `oneOf` pequeno (poucos membros, raso) importa sem problema.

**`swagger2openapi` rejeita `type` como array — normalize antes.** A spec oficial do Mailchimp declara `swagger: "2.0"` mas tem 8 esquemas com `type: ["string","integer"]` (em `variant_ids` de `ecommerce`), o que é JSON-Schema/3.1, não 2.0 válido. O `swagger2openapi@7` aborta com `S2OError: (Patchable) schema type must not be an array`. A saída é colapsar `type: [...]` para um tipo único antes de converter (ex.: `"string"`, já que os IDs vão como texto). Fica no domínio `ecommerce`, que não foi recortado ainda — quem for importar `ecommerce` precisa desse passo.

**A validação tem que rodar na spec dereferenciada, não na fonte.** Na fonte os schemas estão atrás de `$ref` e uma checagem estrutural não os alcança — o array sem `items` do WhatsApp estava dentro de `#/components/schemas/Message` e passava batido.

**`discriminator` sobrevive à dereferência e vira referência pendurada.** O `mapping` aponta para `#/components/schemas/...`, que o `dereference.py` descarta do arquivo. Como os valores são strings e não chaves `$ref`, a checagem de `$ref` restante não os pega. O `oneOf` ao lado já tem os membros expandidos, então remover o `discriminator` não perde campo nenhum.

**OpenAPI 3.1 continua não verificado.** A spec da Meta é 3.1.0 e foi **rebaixada para 3.0.3** antes de importar, com sucesso. Como o rebaixamento veio primeiro, não se sabe se o importador aceitaria 3.1 direto. Rebaixar é barato quando a spec não usa recursos de 3.1 de fato (a da Meta não usava: nenhum `type` como lista, nenhum `$defs`, e usava até `nullable`, que é de 3.0).

---

## 5. Receita para um app novo

1. **Escolher o app** priorizando auth simples (seção 3) e verificar se há sandbox gratuita para testar a conta.
2. **Criar a pasta** `<app>/` em minúsculas com hífen.
3. **Procurar spec oficial antes de escrever qualquer coisa.** Muitos fornecedores publicam OpenAPI; vale conferir a documentação e o índice `llms.txt`, quando existir. O Asaas publica em `https://www.asaas.com/openApi/document?version=3`. Se houver spec oficial, ela é a fonte de verdade e economiza todo o trabalho de levantar schemas.
4. **Se a API for grande, recortar por tag** com `tools/slice_spec.py`. Serviço por domínio, não um serviço com centenas de operações.
5. **Se não houver spec**, levantar os endpoints da fonte mais confiável (código do serviço, documentação) e derivar os schemas de **chamadas reais**. Se um endpoint estiver indisponível, deixá-lo fora em vez de documentar sem verificar.
6. **Gerar as specs do iPaaS**: `python3 tools/dereference.py <app>`.
7. **Escrever `ipaas.json`** e `README.md` seguindo o padrão das pastas existentes.
8. **Commit e push**, e guardar o SHA do commit.
9. **Cadastrar** seguindo a seção 2, usando a URL por SHA na importação.
10. **Validar** conforme 2.6, e depois em um diagrama conforme a seção 6.

### Antes de cadastrar em lote

Faça **um** app inteiro primeiro e valide na tela. Só então repita. Criar app, ambiente e serviço são operações com `DELETE` disponível, então erros são reversíveis:

```
DELETE /ipaas/api/v3/applications/{id}
DELETE /ipaas/api/v2/environments/{id}
DELETE /ipaas/api/v3/application-services/{id}
DELETE /ipaas/api/v3/accounts/{id}
```

Lembre que o tenant em uso é **produção**. Confirme antes de criar em lote.

---

## 6. Validar o app em um diagrama

A validação real de um app é executá-lo num diagrama e conferir a rastreabilidade. Dá para montar o diagrama inteiro via API, sem arrastar caixas — o diagrama é apenas um JSON (`flow`).

### 6.1 Estrutura do flow

```json
{
  "async": false,
  "start": "webhook-sync-trigger",
  "functions": {},
  "activities": {
    "webhook-sync-trigger": {
      "id": "webhook-sync-trigger", "name": "Webhook síncrono", "type": "WEBHOOK_SYNC",
      "label": "Webhook síncrono", "positions": { "top": "9013px", "left": "9000px" },
      "displayName": "backend.components.label.webhookSync", "configurations": {},
      "connections": { "next": ["id1"], "previous": [], "finalConnections": [...] }
    },
    "id1": {
      "id": "id1", "name": "<nome do app>", "type": "REST", "label": "<rótulo da caixa>",
      "isCustom": true, "isDropped": true,
      "positions": { "top": "9000px", "left": "9280px" },
      "serviceId": "<id do serviço>",
      "componentId": "<componentId do app>",
      "componentResourceId": "<id do recurso importado>",
      "originalComponentId": "<componentId do app>",
      "configurations": {
        "name": "<rótulo>",
        "inPath": { "cep": "01310930" },
        "inHeader": {},
        "environmentId": "<id do ambiente>",
        "applicationService": "<id do serviço>"
      },
      "connections": { "next": ["id2"], "previous": ["webhook-sync-trigger"], "finalConnections": [...] }
    },
    "id-synchronous-webhook-response2": {
      "id": "id-synchronous-webhook-response2", "name": "Resposta síncrona",
      "type": "WEBHOOK_RESPONSE", "label": "Resposta síncrona",
      "positions": { "top": "9013px", "left": "..." },
      "displayName": "backend.components.label.syncResponse",
      "originalComponentId": "76c0da1d-ca69-4381-9124-d5d40d9eb106-synchronous-webhook-response",
      "configurations": { "response": "{\n    \"CEP\": {{{id1}}}\n}\n" },
      "connections": { "next": [], "previous": ["id1"] }
    }
  }
}
```

Parâmetros de path do recurso vão em `configurations.inPath`, com a chave igual ao nome do parâmetro. Na resposta síncrona, `{{{idN}}}` interpola o payload inteiro daquele step.

#### Campos de `configurations` de um step REST

Os grupos do formulário do componente são `inPath`, `inQuery`, `inHeader` e `inBody`, e cada um vira uma chave em `configurations`:

| Chave | Uso |
|---|---|
| `name` | rótulo da caixa |
| `environmentId` | ambiente do app |
| `applicationService` | serviço do app |
| `accountId` | **conta**, obrigatório quando o ambiente tem autenticação |
| `inPath` | `{ "id": "123" }` — parâmetros de path |
| `inQuery` | filtros de query string |
| `inHeader` | headers adicionais |
| `inBody` | **corpo da requisição** para POST/PUT |

**`configurations.inBody` é a saída para o corpo que o importador não traz.** O schema importado só determina quais campos a interface exibe; na execução vale o que está em `configurations`. Então dá para montar POST/PUT via API mesmo com o `requestBody` ausente no recurso, preenchendo `inBody` à mão.

Para apps com autenticação, o step precisa de `accountId` — ou seja, **a conta tem que existir antes de montar o diagrama**. Sem ela não há como referenciar a credencial no step.

### 6.2 Criar o diagrama — verificado

**Não existe endpoint de API para criar uma integração.** `POST` em `/v2/integrations`, `/v3/integrations`, `/v1/integrations` e variantes retorna `Request method 'POST' is not supported`; `/v3/diagrams` retorna 403. Fazer `sketch` num UUID inédito falha com `404 FLUIG_CONNECTOR_INTEGRATION_404`.

Integrações vivem dentro de um **projeto**, e a criação é pela interface:

```
Projetos → <projeto> → Criar diagrama → Em branco → nome e descrição → Criar diagrama
```

O diagrama nasce com status `IN_SKETCH`. Pegue o `integrationId` com um GET logo depois:

```
GET /ipaas/api/v3/integrations?page=1&pageSize=50&lastVersion=true&fieldsReturn=id,diagramId,name,status
```

A partir daí todo o resto (montar o flow, salvar, publicar, executar) é API. O projeto usado para validações é `Validação apps` (`b977af3c-db40-4586-bb47-80c4b3b45d89`).

### 6.3 Salvar e publicar — verificado

```
POST /ipaas/api/v2/integrations/sketch/{integrationId}    # rascunho
POST /ipaas/api/v2/integrations/publish/{integrationId}   # publica e ativa
```

Corpo: `{ name, description, flow, icons: [], dynamicIcons: true, descriptionEdit }`.

**A rota é v2**, não v3 nem v4, apesar de o resto da API de integrações ser v3/v4. Em v3/v4 retorna `No static resource`.

**`icons` e `dynamicIcons` são obrigatórios no publish.** Sem eles a resposta é **400 com corpo vazio**, sem nenhuma indicação do campo faltante. No sketch não são obrigatórios.

**Atenção aos tipos: `icons` é array, `dynamicIcons` é boolean.** Passar `dynamicIcons: []` gera `500 JSON parse error: Cannot deserialize value of type boolean from Array value`. Copiar do GET com `it.dynamicIcons || []` funciona por acidente quando o valor é `true`, mas quebra quando é `false`.

`name` é obrigatório: sem ele o erro é uma violação de not-null do banco (`null value in column "name"`).

### 6.4 Versionamento por revisão — importante

Cada sketch/publish cria uma **nova revisão com novo `diagramId`**; o `integrationId` permanece. Consequências:

Ao ler o flow para republicar, use `lastVersion=true`, senão você pega uma revisão antiga e publica o conteúdo errado (aconteceu aqui: publiquei uma versão desatualizada por ler sem esse filtro).

```
GET /ipaas/api/v3/integrations?id={integrationId}&lastVersion=true    # revisão atual
GET /ipaas/api/v3/integrations?id={integrationId}&allVersions=true    # todas as revisões
GET /ipaas/api/v3/integrations?diagramId={diagramId}                  # revisão específica
```

Só uma revisão fica `PUBLISHED`; as anteriores viram `ARCHIVED`. Nada é destruído, então republicar é reversível.

### 6.5 Desenhar as ligações entre as caixas

As conexões lógicas (`next`/`previous`) bastam para **executar**, mas as setas só aparecem no canvas se houver `finalConnections` com o path SVG. Sem elas o fluxo executa por API, mas o diagrama aparece **sem setas** no builder e passa a impressão de não estar ligado nem publicável (visto no Open-Meteo: com `finalConnections: []` os steps ficaram soltos; ao preencher os paths, as setas apareceram e a versão publicou normalmente). Preencha sempre:

```json
"finalConnections": [{
  "connectionId": "id1#id2",
  "connectionPath": "M {sx} {sy}\n    L {sx-32} {sy} L {sx} {sy}\n    L {mx} {sy} L {mx} {ey}\n    T {ex} {ey}"
}]
```

`mx` é a média entre `sx` e `ex`. Offsets dos pontos de conexão, medidos a partir de `positions`:

| Tipo | Saída | Entrada |
|---|---|---|
| `WEBHOOK_SYNC` | `left+66`, `top+32` | — |
| `REST` | `left+79`, `top+45` | `left-9`, `top+45` |
| `WEBHOOK_RESPONSE` | — | `left-8`, `top+32` |

Para uma cadeia em linha reta, coloque os REST em `top` e o trigger/resposta em `top+13`, para que todos os pontos de conexão caiam no mesmo `y`.

### 6.6 Executar e conferir a rastreabilidade — verificado

A `apiKey` do webhook sai direto da API, sem precisar abrir a tela de webhooks:

```
GET /ipaas/api/v3/keys?integrationId={integrationId}
→ { "items": [{ "apiKey": "...", "sync": true, "url": "/sync-hook/api/v1/integrations/{id}/execute" }] }
```

A URL que funciona para o webhook síncrono é com a api-key no path:

```
POST https://api-ipaas.totvs.app/sync-hook/api/v1/integrations/{integrationId}/api-key/{apiKey}
```

O webhook assíncrono usa `/ipaas/api/v1/integrations/{id}/execute` com token.

A resposta traz `{ messageId, result, status, timestamp }`. Para conferir a rastreabilidade:

```
GET /ipaas/api/v4/messages/{messageId}
```

Retorna `status` (`DONE`/`ERROR`), `executionTime`, `initialComponent`, `finalComponent` e `errorStack`. Como o fluxo é sequencial, `status: DONE` com `finalComponent` igual ao último nó comprova que **todos** os steps executaram — se algum falhasse, o fluxo pararia nele.

Cuidado ao interpretar o campo `message`: numa execução `DONE` ele carrega o **payload enviado**, não um erro. Só trate como erro junto com `status: ERROR` ou `errorStack` preenchido.

**`DONE` não prova efeito no mundo real — prova que a chamada foi aceita.** O iPaaS considera sucesso o HTTP 2xx do fornecedor, e plataformas de mensagem aceitam e descartam. No WhatsApp, todos os envios responderam `200` com `message_status: accepted` e **nenhum** foi entregue, por restrição da conta (erro `130497`, ver `whatsapp/README.md`); o diagrama executou `DONE` do mesmo jeito.

Para app de mensageria, trate o `DONE` como validação de **cadastro, contrato e autenticação**, e busque a confirmação de entrega na fonte do fornecedor — webhook de status, relatório ou painel. O mesmo ponto cego vale para o SMS da Brevo, que ficou sem validação por falta de crédito; ali o sintoma foi 500, mais honesto que um 200 que não entrega.

Não encontrei endpoint público de detalhamento por componente (`/components`, `/steps`, `/traceability` retornam 500 ou 403). Para validar recurso por recurso, inclua todos os steps na resposta síncrona e verifique os payloads.

**A tela de detalhe da mensagem (rastreabilidade) pode ficar presa em skeleton.** No Monitor (`/ipaas/monitor`) a listagem carrega e mostra as execuções `DONE` normalmente. Ao abrir uma execução (ícone de olho, rota `/message/{id}`), se a página ficar só com os placeholders de carregamento, a causa mais provável é o nó `WEBHOOK_RESPONSE` sem `originalComponentId` (ver abaixo) — não uma limitação da plataforma. A listagem que funciona usa `GET /v4/messages?sourceTypes=ORIGINAL&status=DONE&status=ERROR&initialDate=<ISO Z>&finalDate=<ISO Z>` (as datas em ISO com `Z` e `sourceTypes` são obrigatórias; sem elas dá 400).

**O nó `WEBHOOK_RESPONSE` sem `originalComponentId` quebra a rastreabilidade.** Se o response node do flow for montado por API sem o campo `originalComponentId`, o backend devolve `componentDTO: null` para esse step em `GET /ipaas/api/v3/steps/{integrationId}/{createdDate}/{messageId}`, e a tela de detalhe estoura com `TypeError: Cannot set properties of null (setting 'name')` em `translateStepLabel` (o front faz `step.componentDTO.name = ...` sem checar null para os steps de webhook). A tela então fica em skeleton e a aba **Rastreabilidade** não abre. Correção: no response node use sempre `"originalComponentId": "76c0da1d-ca69-4381-9124-d5d40d9eb106-synchronous-webhook-response"` — é o id global do componente de resposta síncrona, idêntico em todos os diagramas (BrasilAPI, Asaas, Brevo, Trello). Depois de corrigir e **republicar**, execute de novo: só as mensagens geradas pela revisão corrigida têm o `componentDTO` completo; as execuções antigas continuam quebrando o detalhe.

#### Encadear a saída de um step na entrada do próximo — verificado

`{{{idN}}}` interpola o payload inteiro do step `idN`; `{{{idN.campo}}}` interpola um campo. Funciona em qualquer configuração, inclusive `inPath` e `inBody`:

```json
// consultar o registro criado no step anterior
"configurations": { "inPath": { "id": "{{{id1.id}}}" } }

// criar cobranca vinculada ao cliente criado no step anterior
"configurations": { "inBody": { "customer": "{{{id1.id}}}", "billingType": "BOLETO", "value": 100 } }
```

A interpolação acontece **antes** do envio: a rastreabilidade registra o corpo já com o valor resolvido.

### 6.7 Cuidados ao montar o diagrama de teste

Cheque o tamanho das respostas antes de encadear. `/ncm/v1` da BrasilAPI devolve **2,95 MB** (tabela NCM completa); num fluxo em série com resposta agregada isso tende a estourar payload ou timeout. Foi substituído por `/ncm/v1/{code}`.

Endpoints com parâmetro precisam de valor de teste em `configurations.inPath`, senão a chamada falha.

Agregar todos os payloads na resposta é ótimo para validar, mas pesa: 15 recursos da BrasilAPI resultaram em **476 KB e 38s**. Com só os payloads pequenos, caiu para **7 KB e 9s**. Para uso recorrente, mantenha a resposta enxuta.

---

## 7. Tornar o app global

Duas rotas diferentes, com implicações distintas:

**`POST /ipaas/api/v4/applications/{id}/request-native`** (corpo `null`) — solicita que o app entre no catálogo nativo. É uma **solicitação**, sujeita a aprovação de terceiros; não é um switch. O app passa a ter `requestedNative: true`.

**`POST /ipaas/api/v4/applications/{id}/share`** — compartilha diretamente com uma lista de tenants, sem depender de aprovação. Para remover: `PUT /ipaas/api/v4/applications/{id}/remove-share` com `{ "tenantIds": [...] }`.

Se o objetivo é distribuir para clientes específicos agora, use `share`. Se é entrar no catálogo do produto, use `request-native` e aguarde. Nenhum dos dois foi executado ainda — **não verificado**.

---

## 8. Referência de endpoints

```
# Aplicativos
GET    /ipaas/api/v3/applications?page=1&pageSize=9999&expand=favorite,categories,shares,sharedWithUser,createdDate,status
POST   /ipaas/api/v3/applications
PUT    /ipaas/api/v3/applications/{id}
DELETE /ipaas/api/v3/applications/{id}
GET    /ipaas/api/v4/applications/{id}?includeFields=isCustom&includeFields=isShared&includeFields=requestedNative
PATCH  /ipaas/api/v4/applications/{id}                     # { favorite: bool }
POST   /ipaas/api/v4/applications/{id}/request-native
POST   /ipaas/api/v4/applications/{id}/share
PUT    /ipaas/api/v4/applications/{id}/remove-share        # { tenantIds: [] }
POST   /storage/api/v1/assets/upload?tags={nome}&publicFile=false   # multipart, ícone

# Ambientes
GET    /ipaas/api/v2/environments/?applicationId={id}&expand=authModels&expand=diagrams&expand=accounts&expand=environmentsChild
GET    /ipaas/api/v2/environments/{id}?expand=authModels
POST   /ipaas/api/v2/environments
PUT    /ipaas/api/v2/environments/{id}
PATCH  /ipaas/api/v2/environments/{id}                     # [{ op:"replace", path:"/disconnect", value:bool }]
DELETE /ipaas/api/v2/environments/{id}

# Autenticação
GET    /ipaas/api/v2/auth-models?page=1&pageSize=999

# Contas
GET    /ipaas/api/v3/accounts?componentId={appId}&includeFields=diagrams
GET    /ipaas/api/v3/accounts/details/{id}?expand=environments&expand=diagrams
GET    /ipaas/api/v3/accounts/testAccount/{id}
POST   /ipaas/api/v3/accounts
PUT    /ipaas/api/v3/accounts/{id}
PATCH  /ipaas/api/v3/accounts/{id}                         # [{ op:"replace", path:"/active", value:bool }]
DELETE /ipaas/api/v3/accounts/{id}

# Serviços
GET    /ipaas/api/v3/application-services?applicationId={id}
GET    /ipaas/api/v3/application-services/{id}
POST   /ipaas/api/v3/application-services
PUT    /ipaas/api/v3/application-services/{id}
DELETE /ipaas/api/v3/application-services/{id}

# Recursos e importação
GET    /ipaas/api/v3/rest-resources?serviceId={id}&fields=id&fields=name&page=1&pageSize=9999
GET    /ipaas/api/v3/resources?serviceId={id}&id={resourceId}&expand=properties&expand=model
POST   /ipaas/api/v3/rest-resources/import-swagger         # { applicationId, serviceId, endPoint, swaggerEndPoint, update }
POST   /ipaas/api/v3/rest-resources/schemas
GET    /ipaas/api/v3/soap-resources?serviceId={id}
POST   /ipaas/api/v3/soap-resources/import-wsdl            # { applicationId, serviceId, endPoint, soapEndPoint, update }

# Diagramas (builder)
GET    /ipaas/api/v3/integrations?id={integrationId}&lastVersion=true&fieldsReturn=id,diagramId,flow,name,status
GET    /ipaas/api/v3/integrations?id={integrationId}&allVersions=true
GET    /ipaas/api/v3/integrations?diagramId={diagramId}&fieldsReturn=flow
POST   /ipaas/api/v2/integrations/sketch/{integrationId}   # { name, description, flow, icons, dynamicIcons }
POST   /ipaas/api/v2/integrations/publish/{integrationId}  # idem; icons e dynamicIcons obrigatorios

# Execução e rastreabilidade
GET    /ipaas/api/v3/keys?integrationId={integrationId}    # apiKey do webhook
POST   https://api-ipaas.totvs.app/sync-hook/api/v1/integrations/{integrationId}/api-key/{apiKey}
POST   /ipaas/api/v1/integrations/{integrationId}/execute  # assincrono, com token
GET    /ipaas/api/v4/messages/{messageId}
GET    /ipaas/api/v4/messages?page=1&pageSize=10&status=DONE&status=ERROR&initialDate=...&finalDate=...
```

---

## 9. Histórico

| App | Auth | Operações | Resultado |
|---|---|---|---|
| BrasilAPI | `NO_AUTH` | 16 | 16 recursos importados; 15 validados em diagrama, execução `DONE` |
| Asaas | `API_KEY` (header `access_token`) | 41 em 3 serviços | 41 recursos importados; conta criada e validada; diagrama com POST (`inBody`) e encadeamento entre steps executado `DONE`, criando cliente e cobrança reais no sandbox |
| Brevo | `API_KEY` (header `api-key`) | 68 em 4 serviços | 68 recursos importados a partir da spec oficial convertida de Swagger 2.0; conta criada; diagrama com 6 steps em 3 serviços executado `DONE`, incluindo `POST /smtp/email` em modo sandbox. Serviço `SMS Transacional` **não validado**: plano gratuito não tem crédito de SMS e todos os endpoints respondem 500 |
| Trello | `API_KEY` (query `key` + `token`) | 151 em 5 serviços | 151 recursos importados; exigiu injetar `tags` (a spec oficial não tem nenhuma) e remover `securitySchemes` em query, que quebrava o importador; conta com **duas** chaves em query criada; diagrama com 6 steps em 4 serviços executado `DONE`, criando cartão real e encadeando `{{{id4.id}}}` |
| Open-Meteo | `NO_AUTH` | 9 em 9 serviços | Spec oficial já recortada por domínio, convertida de OpenAPI 3.1.0 YAML para 3.0.3 JSON; 9 recursos importados; **7 ambientes** (um por subdomínio) porque cada domínio tem um host próprio; diagrama com 9 steps executado `DONE`, agregando os 9 payloads reais na resposta síncrona |
| WhatsApp | `TOKEN` (Bearer) | 100 em 6 serviços | Spec oficial da Meta (`github.com/facebook/openapi`), 113 operações recortadas em 100; convertida de 3.1.0 para 3.0.3; `/{Version}` movido do path para a URL do ambiente; 13 operações sem `tags` retagueadas em 6 domínios; 100 recursos importados e conferidos campo a campo. Diagrama com 5 steps executado `DONE` em 11,4s, com os payloads reais de cada serviço. A entrega **passou a funcionar** depois que um número próprio brasileiro verificado (`VERIFIED`/`LIVE`) substituiu o número de teste americano e a WABA ficou `account_review_status: APPROVED`: template (primeiro contato) e texto livre (janela de 24h aberta) chegaram no aparelho, tanto por chamada direta quanto pelo diagrama. Antes, com o número de teste, os envios recebiam `accepted` e **não entregavam** (erro `130497`, cross-country para o Brasil em conta sem verificação de negócio, só visível no webhook de status). Trocar de número **não** exigiu recriar ambiente/conta nem reimportar: só mudar `phone_number_id`/`WABA-ID` no `inPath` dos steps (ver `whatsapp/CADASTRO-NUMERO.md`). Três armadilhas novas achadas: **import assíncrono** (200 não significa concluído), **`array` sem `items` no `requestBody`** zerando a spec em silêncio, e **`PUT` de conta sem `active: true`** desativando a credencial. A spec oficial da Meta documenta **menos** campos do que a API devolve — 16 acrescentados por observação de resposta real |
| BioDoc | `TOKEN` (Bearer) | 12 em 3 serviços | Reconhecimento facial para saúde. **Sem OpenAPI oficial** — a doc (`docs.biodoc.com.br`) é textual; specs escritas à mão a partir dela, recortadas em Cartões (6), Verificação (2) e Justificativas e Auditoria (4). 12 recursos importados e conferidos. Diagrama com 1 step executado `DONE` em 4,1s via `GET /integrations/justify`. **Validação parcial**: só o serviço de auditoria foi exercitado em execução; Cartões e Verificação dependem de `idCard` de teste e imagem base64 de rosto no sandbox, indisponíveis na sessão — o `DONE` valida cadastro/contrato/auth, não o match facial (mesmo ponto cego da mensageria). Ambiente Sandbox só; Produção não cadastrada. Duas descobertas de ambiente: **máquina sem Python** (só Node) — criada a porta `tools/dereference.mjs`; e o **cadastro rodou por JS colado no console do navegador** (F12), sem MCP do Chrome, em Windows |
| Mailchimp | `BASIC` (API key como senha) | 140 em 6 serviços | **Primeiro app `BASIC`** — fecha o quarto padrão viável (seção 11). Username é qualquer string, password é a API key. Spec oficial (`mailchimp/mailchimp-client-lib-codegen`, `spec/marketing.json`) em **Swagger 2.0**, convertida para OpenAPI 3.0.3 e recortada por domínio: Audiências (70), Campanhas (22), Relatórios (22), Automações (18), Templates (6), Conta e Ping (2). Base URL é **data-center-específico** (`https://{dc}.api.mailchimp.com/3.0`; o `host` da spec, `server.api.mailchimp.com`, é placeholder e não resolve) — o dc sai do sufixo da API key (`us1`). Diagrama com 5 GETs read-only executado `DONE` em 3,6s, com payloads reais (`/ping` = "Everything's Chimpy!", `/` com dados da conta). Três descobertas: **`oneOf` grande e profundo em resposta zera o import em silêncio** (41 membros em `segment_opts.conditions` derrubavam Audiências e Campanhas — corrigido com o colapso de `oneOf` no `dereference`); **`swagger2openapi` rejeita `type: [...]` array** (8 casos em `ecommerce`, normalizar antes); e criada a porta **`tools/slice_spec.mjs`** (máquina sem Python). Cadastro por JS no console (F12), sem MCP. **Não validado em execução**: escrita (POST, precisa `inBody`) e os serviços Templates/Automações. Credencial passou pelo navegador — **rotacionar**. Publicado no fork `HugoHSevero/ipaas-api-docs` (`add-mailchimp`), importado por SHA; PR para `dugabriel:main` pendente |

---

## 10. Estado atual no tenant

Levantado por API. Use como referência para não recriar o que existe — mas **confirme com um GET** antes de assumir, porque o tenant é compartilhado e pode ter mudado.

### BrasilAPI — `NO_AUTH`

| Item | Id |
|---|---|
| App (`componentId`) | `a7b79983-1a4a-4271-a0ce-9a7d077fcba8` |
| Ambiente `Produção` (`https://brasilapi.com.br/api`) | `a67b7353-c0a8-40e6-a14b-df4e7faf0ed2` |
| Serviço `Dados Públicos` (16 recursos) | `91f002ba-f6df-41e7-987f-866f51a786b8` |
| Diagrama `Valida BrasilAPI` (`integrationId`) | `d14a9502-0731-4c55-a16c-c8623ec29b0d` |

Sem contas (não precisa, é `NO_AUTH`).

### Asaas — `API_KEY` no header `access_token`

| Item | Id |
|---|---|
| App (`componentId`) | `38f9ca5d-effe-4dfa-bd2a-b04146c29ffe` |
| Ambiente custom (`https://{environment}.asaas.com`) | `6bb42135-d8dd-4680-8023-f2f80782c214` |
| └ filho `Sandbox` (`https://api-sandbox.asaas.com`) | `6a1dd8e8-587d-4c7d-9407-633f0ec20510` |
| Conta `Sandbox` | `5424ca20-fb6c-4b12-9e59-bc900141b89c` |
| Serviço `Clientes` (7 recursos) | `a0a062ca-aba7-421e-8da1-1970a0570656` |
| Serviço `Cobranças` (20 recursos) | `4b854fcc-1e4a-454e-9119-e39a21e0d2e7` |
| Serviço `Assinaturas` (14 recursos) | `2b60d0e2-6aab-472d-977e-4db1052cfe32` |
| Diagrama `Valida Asaas` (`integrationId`) | `8a277176-8cf0-4278-bb2f-4c4f6f00943f` |

Nos steps do diagrama use o **ambiente filho** (`6a1dd8e8`), que tem URL concreta, não o pai com placeholder.

A chave de sandbox usada na conta foi compartilhada em chat e **deve ser rotacionada**. Se a execução começar a dar 401, é provável que tenha sido trocada — peça a nova ao usuário e atualize a conta com `PUT /ipaas/api/v3/accounts/{id}`.

O sandbox do Asaas já tem um cliente (`cus_000008990297`) e uma cobrança (`pay_5t28kq86iwolagvm`) criados pelo teste. Se for reexecutar o diagrama de validação, ele cria novos registros a cada execução — o CPF `11144477735` é aceito repetidamente, mas a listagem vai acumulando.

### Brevo — `API_KEY` no header `api-key`

| Item | Id |
|---|---|
| App (`componentId`) | `007c857b-3406-4daa-9df4-ba7b19c708f8` |
| Ambiente `Produção` (`https://api.brevo.com/v3`) | `9a1baff7-f35d-4a3c-8b57-51c72406314e` |
| Serviço `Contatos` (29 recursos) | `6cf4a050-621f-4e5f-b102-2b62ffc32943` |
| Serviço `E-mails Transacionais` (22 recursos) | `322bff7d-0083-4424-9ba5-85f10445346a` |
| Serviço `Campanhas de E-mail` (13 recursos) | `25003ddf-8ec3-42e4-bf73-e88a3dcc4daa` |
| Serviço `SMS Transacional` (4 recursos) | `af9d7b37-8466-4dc1-98cc-779fecb9321d` |
| Conta `Produção` | `b03e1504-3c2a-433d-8eab-7b284e20a9ee` |
| Diagrama `Valida Brevo` (`integrationId`) | `2fac8db9-52b2-4cdc-84a1-c64aac779c44` |

A chave usada na conta foi compartilhada em chat e **deve ser rotacionada**. Se a execução começar a dar 401, é provável que tenha sido trocada — peça a nova e atualize com `PUT /ipaas/api/v3/accounts/{id}`.

**A Brevo tem allowlist de IP no lado do fornecedor.** Com ela restritiva, a API responde `401` com `unrecognised IP address <ip>` e o `code: unauthorized`, mesmo com chave válida — vale para qualquer cliente, inclusive o iPaaS. Configuração em `app.brevo.com/security/authorised_ips`. Depois de o usuário liberar, as chamadas passaram tanto da máquina local quanto do iPaaS; **não foi verificado** se isso ocorreu porque a autorização automática foi ligada ou porque o bloqueio foi desativado. Se um app começar a dar 401 do nada, verifique se o fornecedor tem esse tipo de restrição antes de suspeitar da credencial.

**Os endpoints de SMS não funcionam no plano gratuito.** `GET /transactionalSMS/statistics/*` responde `500 invalid_request` com ou sem parâmetros. O `plan` da conta mostra só `{"type":"free","credits":300,"creditsType":"sendLimit"}`, sem crédito de SMS. É limitação da conta, não da spec — o serviço está importado e correto, só não dá para exercitar.

**O `POST /smtp/email` em modo sandbox funcionou via `inBody`.** Basta incluir `"headers": { "X-Sib-Sandbox": "drop" }` dentro do corpo. A Brevo devolve `messageId` real do relay, não envia e-mail e não registra a chamada nas estatísticas (`requests: 0` no dia). É a forma barata de validar operações de escrita sem efeito colateral.

### Trello — `API_KEY` em `query` (`key` + `token`)

| Item | Id |
|---|---|
| App (`componentId`) | `34ad64d8-8f8b-4094-8660-25a020c6a6b9` |
| Ambiente `Produção` (`https://api.trello.com/1`) | `088988f8-273b-4e89-953a-d2774b1ba6ba` |
| Serviço `Quadros` (41 recursos) | `cd3986a6-9d85-43fc-98aa-4c674cf2c06e` |
| Serviço `Cartões` (42 recursos) | `d1c475b5-286e-4ea6-ad96-6083cbed4404` |
| Serviço `Listas` (11 recursos) | `74ea1120-5a3a-428d-bb72-3c1255b9b38d` |
| Serviço `Checklists` (12 recursos) | `c2dbb561-de72-4f2b-bfa1-88e81132e912` |
| Serviço `Membros` (45 recursos) | `fd451172-56a2-4213-8dd7-3917f8002b35` |
| Conta `Produção` (`key` + `token` em query) | `6cbe201d-20ac-4690-ab14-41ed3eadda27` |
| Diagrama `Valida Trello` (`integrationId`) | `efd24ad0-700d-45b0-8762-6b2d3ab5c917` |

Primeiro app com `addTo: query` e com **duas chaves na mesma conta**. O modelo `API_KEY` aceita a lista, então `key` e `token` convivem sem precisar de nada especial:

```json
"config": { "outputSchema": { "addTo": "query",
  "keys": [{ "key": "key", "value": "..." }, { "key": "token", "value": "..." }] } }
```

As credenciais usadas foram compartilhadas em chat e **devem ser rotacionadas**. Cuidado para não confundir as três coisas que o Trello chama de credencial: a **API key** identifica o Power-Up, o **secret** só serve para assinatura OAuth1 (o iPaaS não usa) e o **token** é o que vai em `?token=`. Passar o secret como token responde `401 invalid key`, mensagem que não ajuda. O token se gera em:

```
https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&name=<app>&key=<APIKey>
```

**O Trello passa tudo em query, inclusive escrita.** `POST /cards` tem 18 parâmetros, todos `in: query`, e nenhum `requestBody`. Ou seja, a limitação do importador com corpo de POST/PUT (seção 4) **não afeta este app** — os campos de escrita vêm no `inQuery` do recurso e o diagrama usa `configurations.inQuery`.

**A spec oficial não descreve a resposta de 91 das 151 operações.** Os recursos importam e executam normalmente: na validação, `GET /boards/{id}/lists` (sem schema na spec) devolveu as 4 listas no payload. O que falta é o mapeamento campo a campo no builder. Conferido no import: `GET /boards/{id}` com 26 campos de resposta, `inPath(1)`, `inQuery(16)`; `GET /boards/{id}/cards` com 0 campos.

O quadro de teste é `Meu quadro do Trello` (`6a997347d853e6791ec05a9c`), lista `Hoje` (`6a997347d853e6791ec05b1a`). A execução criou o cartão `6a997aa9b8b19364ad236f50` de verdade; reexecutar o diagrama cria um novo cartão a cada vez.

### Open-Meteo — `NO_AUTH`

Cada domínio do Open-Meteo tem um **subdomínio próprio**, e como o `baseURL` fica no ambiente, o app tem **um ambiente por subdomínio** (`Previsão do Tempo` e `Elevação` compartilham `api.open-meteo.com`). Um serviço por domínio, um recurso por serviço.

| Item | Id |
|---|---|
| App (`componentId`) | `32c933f2-9b04-4f52-9954-4c90eaf8232e` |
| Ambiente `api.open-meteo.com` | `d50c95c4-4734-4ddc-afef-1b9512dd959a` |
| Ambiente `air-quality-api.open-meteo.com` | `81eff3fc-c995-4ee0-b40e-2a686a4bce83` |
| Ambiente `climate-api.open-meteo.com` | `b5c7d8d0-60ca-4828-91c8-a039c03c7dcc` |
| Ambiente `ensemble-api.open-meteo.com` | `9ae100de-61f4-41a4-ad08-6b83b7525d20` |
| Ambiente `flood-api.open-meteo.com` | `cc2f667b-0965-4759-bb46-22b3aaffb04d` |
| Ambiente `archive-api.open-meteo.com` | `d1b8c2bd-3945-4025-8c30-cdcf893ff599` |
| Ambiente `marine-api.open-meteo.com` | `57cfa934-132b-4175-98dd-e13424d5d0ab` |
| Ambiente `seasonal-api.open-meteo.com` | `e94c443c-8163-4c60-9f8f-087e52730b5c` |
| Serviço `Previsão do Tempo` (`/v1/forecast`) | `35ec0792-a420-4ef0-aa64-41d6203c8343` |
| Serviço `Elevação` (`/v1/elevation`) | `18a4a79f-d749-4461-9dad-be7255e95037` |
| Serviço `Qualidade do Ar` (`/v1/air-quality`) | `4f007292-0189-445d-b856-9bd2d1f7786b` |
| Serviço `Clima` (`/v1/climate`) | `1b7ec4ee-d0ca-4e71-aee8-411ff3964112` |
| Serviço `Ensemble` (`/v1/ensemble`) | `def8a334-2dbb-47d7-bf76-6c89af26d172` |
| Serviço `Enchentes` (`/v1/flood`) | `bbb0f72d-54a8-4a62-873a-c7df3f104056` |
| Serviço `Histórico Meteorológico` (`/v1/archive`) | `7d9a5b69-0808-4e26-aa6d-d7b16fc734ad` |
| Serviço `Meteorologia Marinha` (`/v1/marine`) | `45f06555-78d5-40de-b25f-61d2a78a5934` |
| Serviço `Previsão Sazonal` (`/v1/seasonal`) | `47f6ed98-1615-46ae-b0ce-f67e4dadc004` |
| Diagrama `Valida Open-Meteo` (`integrationId`) | `be2bd4cd-9195-42ed-affd-0bdde62778bc` |

Sem contas (é `NO_AUTH`). Todos os parâmetros vão em query (`latitude`/`longitude` obrigatórios; `Clima` e `Histórico` também exigem `start_date`/`end_date`), então no diagrama use `configurations.inQuery`. A resposta síncrona do webhook vem embrulhada em um objeto `result`. Na validação, os 9 serviços responderam com dados reais em uma única execução `DONE` (7,5s).

Os subdomínios `customer-*` (planos pagos com `apikey`) foram descartados das specs; ficam só as origens públicas. A spec foi publicada primeiro no fork `Jonathanfdr/ipaas-api-docs` (branch `open-meteo`) e importada por URL raw do fork por SHA, enquanto o PR para `dugabriel:main` não é mergeado. As URLs em `open-meteo/ipaas.json` já apontam para `dugabriel/.../main/` (valem após o merge).

### API BRASIL (app nativo TOTVS) — `NO_AUTH`
App do catálogo TOTVS, não do nosso tenant (`ownerTenantName: TOTVS`, `isCustom: false`). Já existia com um serviço `Api` de um único recurso; recebeu um serviço novo com a spec completa da BrasilAPI.

| Item | Id |
|---|---|
| App (`componentId`) | `309b2080-c708-4de5-8145-63dda163acc9` |
| Ambiente `Brasil Api` (`https://brasilapi.com.br/api`) | `55101f14-1649-42f9-beca-0e09b75940a9` |
| Serviço `Api` (1 recurso, pré-existente — **não mexer**) | `3ca60099-a49e-4990-a113-77193e762d28` |
| Serviço `Dados Públicos` (16 recursos, criado por nós) | `f2c362d3-0580-44e7-aa51-e64c14147aef` |

A API aceitou a escrita num app de outro tenant sem erro. **Não foi verificado** se o serviço criado fica visível para os outros tenants que usam o app nativo. Antes de repetir esse padrão, decida a política: app custom nosso com `share`/`request-native` depois (seção 7), ou complementar app nativo existente.

Isso torna a BrasilAPI **duplicada** no tenant: o app custom `BrasilAPI` (`a7b79983`) e o serviço novo no app nativo. Decidir qual manter.

### WhatsApp — `TOKEN` (Bearer)

Primeiro app com o modelo `TOKEN`. Spec oficial da Meta em `github.com/facebook/openapi` (`business-messaging-api_v23.0.yaml`), rebaixada de 3.1.0 para 3.0.3 e recortada em 5 serviços.

| Item | Id |
|---|---|
| App (`componentId`) | `1a7e0d94-acb9-4542-8fbb-814f7e68cc83` |
| Ambiente `Produção` (`https://graph.facebook.com/v23.0`) | `e4a5e785-1399-418d-9e87-e766349c4092` |
| Conta `Produção` (token de usuário do sistema) | `5b141001-9878-4a7f-92fc-41ab0a9d351b` |
| Serviço `Mensagens` (11 recursos) | `dc62547f-b583-4cbe-a426-cabdca845f2a` |
| Serviço `Templates` (5 recursos) | `afb4ea78-d8bb-4630-83eb-5168e2296f21` |
| Serviço `Números` (29 recursos) | `b36e6257-6a63-4c78-9c1f-3ce53825d59b` |
| Serviço `Contas` (13 recursos) | `1139b793-bdbc-4902-9b86-f24edc056e6d` |
| Serviço `Grupos` (12 recursos) | `d0b78ea7-69f0-4167-80b0-2cb2ec4a4210` |
| Serviço `Parceiros` (30 recursos) | `25053254-303f-41e4-92a7-8e1506326730` |
| Diagrama `Valida WhatsApp` (`integrationId`) | `bbec9bcc-1983-4466-b690-bfc64253d06d` |

Os 100 recursos foram importados e conferidos: contagem por serviço bate com a spec e o `responseBody` traz os campos do objeto, não um `response` string. O diagrama de validação encadeia um recurso de cada serviço e executou `DONE` em **11,4s**, com os cinco payloads reais agregados na resposta síncrona.

**A entrega passou a funcionar com número próprio verificado.** Na primeira validação, com o número de teste americano, o `POST /messages` recebia `accepted` mas a mensagem **não chegava ao aparelho** — a Meta restringe tráfego cross-country para o Brasil em conta sem verificação de negócio (erro `130497`, só visível no webhook de status). Depois de conectar um **número brasileiro próprio** (`code_verification_status: VERIFIED`, `account_mode: LIVE`) numa WABA com `account_review_status: APPROVED`, a entrega funcionou: **template** (primeiro contato) e **texto livre** (janela de 24h aberta) chegaram no aparelho, tanto por chamada direta à Graph API quanto pelo diagrama do iPaaS (`DONE`, `errorStack` nulo). A troca de número **não exigiu** recriar ambiente, conta ou reimportar spec: só atualizar `phone_number_id`/`WABA-ID` no `configurations.inPath` dos steps. O passo a passo recorrente (lado Meta + vínculo iPaaS) está em [`whatsapp/CADASTRO-NUMERO.md`](./whatsapp/CADASTRO-NUMERO.md). Continua valendo o alerta geral (seção 6.6): `DONE`/`accepted` não prova entrega — para número de teste ou negócio não verificado, confirme no webhook de status ou no aparelho.

**A credencial é o token de usuário do sistema, não o do painel.** O token oferecido em Configuração da API é `type: USER` e expira no mesmo dia; o correto é `type: SYSTEM_USER` com `expires_at: 0`. Confira antes de cadastrar:

```
GET https://graph.facebook.com/v23.0/debug_token?input_token=$T&access_token=$T
```

Para gerar o certo, o usuário do sistema precisa ter o **app** atribuído como ativo com `Gerenciar app`, além da WABA. Sem o app atribuído, a tela de gerar token mostra "Nenhuma permissão disponível — atribua uma função do app ao usuário do sistema": o token é emitido para um app, e sem função nele não há permissão para oferecer. Se o app não aparecer na lista de ativos, ele não está no portfólio empresarial (Contas → Aplicativos → Adicionar um app).

`phone_number_id` e WABA ID **não** são configuração do ambiente: entram como parâmetro de caminho em cada operação, via `configurations.inPath`. A mesma conta atende vários números.

A versão da Graph API está na **URL do ambiente**, não em parâmetro, porque os paths da spec tiveram o `/{Version}` removido. Trocar de versão exige regerar as specs, não reconfigurar o ambiente.

A serviço da rastreabilidade: a bissecção que achou a armadilha do `array` sem `items` (seção 4) criou 56 serviços `ZZ ...` neste app, todos removidos depois com `DELETE /v3/application-services/{id}`.

### BioDoc — `TOKEN` (Bearer)

Plataforma de reconhecimento facial para saúde. Sem OpenAPI oficial: specs escritas à mão a partir de `docs.biodoc.com.br`. Cadastrado só no ambiente **Sandbox**; Produção (`https://api.biodoc.com.br/api`) ainda não criada.

| Item | Id |
|---|---|
| App (`componentId`) | `447d7705-9ce0-468e-a80a-8b1cbf268bed` |
| Ambiente `Sandbox` (`https://api.sandbox.biodoc.com.br/api`) | `4df750df-5a2a-4cd7-892c-22c5c779536f` |
| Conta `Sandebox` (TOKEN) | `c7df13a5-d28d-4bdd-886b-5d2510f3a1b3` |
| Serviço `Cartões` (6 recursos) | `b00919b4-ca78-4880-be85-005e066792f3` |
| Serviço `Verificação` (2 recursos) | `ebb8a253-a57c-4cd5-8bd6-cc97b1660cfe` |
| Serviço `Justificativas e Auditoria` (4 recursos) | `883bfca9-91eb-489d-85a7-da0c263cc68b` |
| Diagrama `Valida BioDoc` (`integrationId`) | `fd3e344b-b213-48fb-ad95-3fedf45e1198` |

O token da conta foi colado pelo usuário direto na interface/console e **deve ser rotacionado**. O nome da conta ficou `Sandebox` (typo, criada à mão) — cosmético, corrigir por `PUT /v3/accounts/{id}` com o corpo completo e `active: true` se incomodar.

**Validação parcial, por design.** O diagrama executou `DONE` (4,1s) com `GET /integrations/justify`, que só lê. Isso valida cadastro, contrato e o token. Os outros dois serviços **não foram exercitados em execução**: `POST /card/register`, `/card/integration/mainimage` e os dois `verify` exigem um `idCard` de teste cadastrado no sandbox e uma imagem base64 de rosto real, que não estavam à mão. Como em app de mensageria, um `DONE` nesses endpoints comprovaria a chamada aceita, não o acerto biométrico — a confirmação do match tem que vir da própria BioDoc.

**7 das 12 operações são POST com corpo** — importador não traz `requestBody` (seção 4), então o corpo vai em `configurations.inBody` no diagrama. `POST /card/integration/verify` e `POST /requestnewimage` são `multipart/form-data`, não JSON; **não verificado** como o iPaaS monta o corpo `multipart` em execução (o step validado é GET, sem corpo).

**Descobertas de ambiente desta sessão:**

- **Máquina sem Python, só Node.** O `dereference.py` não roda. Foi criada uma porta em Node, `tools/dereference.mjs`, que replica o comportamento (resolve `$ref`, mescla `allOf`, remove `discriminator` e `securitySchemes` em query, valida os requisitos do importador). Uso: `node tools/dereference.mjs <app>`. Onde houver Python, o `.py` continua valendo e produz o mesmo resultado.
- **Cadastro sem MCP do Chrome, por JS no console.** O setup do MCP do README (seção "Pré-requisito") só cobre Linux e depende de instalar/ligar o `chrome-devtools-mcp`. Nesta sessão (Windows) o MCP não estava disponível e o usuário preferiu operar à mão: o agente forneceu trechos de JS colados no **Console do navegador** (F12) da aba já logada, e o próprio script leu o token do cookie `jwt.token` e fez as chamadas de API. Funciona bem para tudo, menos criar a integração — que continua sendo pela interface (seção 6.2). Vale como caminho alternativo quando não há navegador controlável: **não precisa de MCP para cadastrar**, só para automatizar cliques.

### Mailchimp — `BASIC` (API key como senha)

Primeiro app com o modelo `BASIC`. Spec oficial (`mailchimp/mailchimp-client-lib-codegen`, `spec/marketing.json`) em Swagger 2.0, convertida para OpenAPI 3.0.3 e recortada em 6 serviços. Base URL data-center-específico: o `us1` vem do sufixo da API key do usuário.

| Item | Id |
|---|---|
| App (`componentId`) | `d07e88d3-5a40-4c6a-920b-eb55579032a6` |
| Ambiente `Produção` (`https://us1.api.mailchimp.com/3.0`) | `9efd2a32-ba1c-4da4-8807-0f90349dd79b` |
| Conta `Produção` (BASIC, username `mailchimp` + API key) | `08d6122e-c0bb-4c94-b50f-bd760f0a6479` |
| Serviço `Audiências` (70 recursos) | `75ed9ddb-53d9-4841-bc5c-4fd5b1399d52` |
| Serviço `Campanhas` (22 recursos) | `aaeb3a4a-bde7-4975-872c-3823d0098917` |
| Serviço `Relatórios` (22 recursos) | `b9ec9a18-6285-4666-b752-76d924c81836` |
| Serviço `Automações` (18 recursos) | `9138b276-5e90-45d6-9971-592a2f90ef08` |
| Serviço `Templates` (6 recursos) | `dce425c7-9dcc-4fde-b9cb-074b498325df` |
| Serviço `Conta e Ping` (2 recursos) | `564c7f4d-94da-41e5-909d-09ada86c1342` |
| Diagrama `Valida Mailchimp` (`integrationId`) | `898ede31-d87e-486c-818a-7e688b2c373d` |

A API key foi setada no console e usada na conta; **deve ser rotacionada**. Se a execução começar a dar 401, é provável que tenha sido trocada — peça a nova e atualize com `PUT /ipaas/api/v3/accounts/{id}` (corpo completo, `active: true`).

O data center está na **URL do ambiente**, não em parâmetro. Uma conta de outro data center exigiria outro ambiente (ou um ambiente custom com placeholder, à la Asaas). `phone_number`/`list_id`/`campaign_id` etc. vão como parâmetro de caminho por operação, via `configurations.inPath`.

Validado com 5 GETs read-only (`DONE`, 3,6s). **Não exercitados em execução**: escrita (POST — precisa `configurations.inBody`, o importador não traz o corpo) e os serviços `Templates` e `Automações`. Domínios fora do recorte (`ecommerce`, `sms-campaigns`, `reporting`, `fileManager`, ...) listados no `mailchimp/README.md`.

**As specs foram publicadas no fork `HugoHSevero/ipaas-api-docs` (branch `add-mailchimp`), não em `dugabriel`** — o push para `origin` (dugabriel) deu 403 por falta de permissão. A importação usou a URL raw do fork por SHA (`40304e6`), como o Open-Meteo fez. O PR do fork para `dugabriel:main` está **pendente**; as URLs `dugabriel/.../main` no `ipaas.json` e no README valem após o merge.

### Nota sobre este levantamento

A seção 10 estava **desatualizada** no início desta sessão: o `GET /applications` do tenant `iPaaS Gateway` trouxe 83 apps (19 custom), com nomes que não batiam com o histórico (apareceram `Anymarket`, `Intelipost`, `Protheus`, e não apareceram na amostra `Trello`/`Asaas`/`Brevo`/`BioDoc`). O tenant é compartilhado e muda; **confirme sempre com um GET** antes de assumir os IDs acima.

---

## 11. Fila de próximos apps

Ordenada por custo de integração. O critério é o modelo de autenticação (seção 3) e a existência de spec oficial.

### Padrões de auth — status

Os quatro padrões viáveis estão **todos cobertos**: `API_KEY` em `query` pelo **Trello**, `TOKEN` pelo **WhatsApp**, `BASIC` pelo **Mailchimp** (seção 10), além de `NO_AUTH` (BrasilAPI, Open-Meteo) e `API_KEY` em header (Asaas, Brevo). O catálogo está pronto para escalar sem padrão de auth novo pela frente.

Se quiser mais um `BASIC` para reforçar o padrão: Jira Cloud (plano free permanente, API token instantâneo em `id.atlassian.com`, spec oficial em `developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json`, grande, exige recorte), Twilio, Zendesk.

Candidatos `TOKEN` que ficaram na fila: HubSpot (token de private app em developer test account free, spec oficial por objeto), ZapSign (API Token estático, conta free, sem spec oficial, alta relevância BR), SendGrid, Notion, Airtable, Asana.

Levantado em 2026-09-03 a partir da documentação dos fornecedores; a facilidade de obter credencial muda com o tempo, reconfirme antes de começar.

### Brasileiros relevantes

Mercado Pago (Bearer), Vindi e Iugu (`BASIC`), Tiny (token em query), Melhor Envio, Conta Azul, Nuvemshop.

### Evitar por enquanto

**Omie** — manda `app_key`/`app_secret` no corpo da requisição, e não existe auth model para isso (seção 3).

**Bling v3** — `OAUTH2_CODE`, exige interação de navegador para obter o `code`; não é automatizável em lote.

**Monday.com** — GraphQL, um único endpoint POST; o modelo de recursos REST do iPaaS não se aplica bem.

### APIs grandes que exigem recorte

Stripe, GitHub e Salesforce publicam spec oficial com centenas de operações. Use `tools/slice_spec.py` e crie um serviço por domínio; nunca importe a spec inteira em um serviço só.
