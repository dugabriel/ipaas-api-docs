# ipaas-api-docs

Catálogo de especificações OpenAPI de apps de mercado para cadastro no **TOTVS iPaaS**.

Cada app tem uma pasta com a spec, a documentação de cadastro e os metadados. As specs são servidas pelo `raw.githubusercontent.com` e consumidas diretamente pela função **Importar Swagger** do iPaaS, que aceita apenas URL — não upload de arquivo.

> O repositório precisa permanecer **público**. O iPaaS baixa a spec por URL anônima; em repositório privado a importação falha.

## Para cadastrar um app novo

Leia o **[Playbook de cadastro no iPaaS](./IPAAS-PLAYBOOK.md)**, começando pela seção **0 (Arranque rápido)**.

O playbook tem a API completa, os payloads que funcionam, os IDs dos modelos de autenticação, as armadilhas do importador, o checklist de validação, o **estado atual do tenant** (o que já existe, com IDs) e a **fila de próximos apps**.

Em resumo, o caminho é:

```
Aplicativo → Ambiente → [Conta] → Serviço → Importar Swagger → Validar → Diagrama
```

### Pré-requisito: MCP do Chrome

O cadastro **não é feito por API pura**. Diagrama novo só nasce pela interface (seção 6.2 do playbook) e o token de autenticação vem do cookie `jwt.token` de uma página já logada (seção 1). Sem navegador controlável, o agente não passa da metade do caminho.

Configure o [`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp) em `~/.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--autoConnect"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

O `--autoConnect` é o que faz a coisa funcionar em desktop Linux moderno. Sem ele o servidor tenta **lançar** um Chrome próprio, não herda o `DISPLAY` da sessão e morre com `Missing X server to start the headful browser` — verificado em Ubuntu 26.04 / Wayland. Com `--autoConnect` ele **anexa** ao Chrome que já está aberto, o que também preserva seus logins do TOTVS Identity e da Meta entre sessões.

Para habilitar o lado do Chrome, abra `chrome://inspect/#remote-debugging` e ligue o Remote Debugging. Requer Chrome 144+.

Alternativa, se você não quiser que o agente compartilhe a janela que você usa: suba uma instância dedicada e conecte por porta fixa. Trocar o argumento por `"--browserUrl", "http://127.0.0.1:9222"` — dois itens separados no array, senão o servidor recebe a flag sem valor e não conecta — e subir o Chrome com:

```bash
setsid -f google-chrome --remote-debugging-port=9222 \
  --user-data-dir=~/.cache/chrome-kiro \
  --no-first-run --no-default-browser-check about:blank
```

Use `setsid -f`, não `nohup ... &`. Com `nohup` o Chrome sobe, escreve o `DevTools listening on ws://...` no log e **morre** quando o comando do agente termina, porque vai junto com o grupo de processos — verificado. Mantenha o mesmo `--user-data-dir` entre sessões para não ter que refazer os logins de SSO.

Não use `--headless`: o login no TOTVS Identity é SSO com MFA e precisa ser feito por você, à mão, na janela visível.

### Prompt inicial

O cadastro é feito com um agente operando o navegador e a API do iPaaS. Cole o prompt abaixo no começo da sessão, trocando o nome do app:

```
Vamos cadastrar um app novo no TOTVS iPaaS: <NOME DO APP>.

Antes de mexer em qualquer coisa:

1. Leia o IPAAS-PLAYBOOK.md deste repositório: seções 0, 1, 2 e 4 são
   obrigatórias; 3, 6, 8 e 10 são consulta.
2. Abra o Chrome em https://ipaas.totvs.app. Ele redireciona para o login do
   TOTVS Identity. Me avise e ESPERE eu confirmar que loguei — não tente
   automatizar SSO/MFA nem ler credenciais de nenhum arquivo.
3. Depois que eu confirmar, valide a sessão com uma chamada real à API usando
   o token do cookie jwt.token, e me diga em qual tenant estamos.
4. Confirme por GET o que já existe no tenant antes de criar qualquer coisa
   (a seção 10 do playbook pode estar desatualizada).

Depois siga a receita da seção 5. Regras da casa:

- Procure a spec oficial do fornecedor antes de escrever qualquer spec à mão.
- Recorte por domínio: vários serviços pequenos, nunca um com centenas de
  operações.
- Não versione credenciais. Me peça a chave quando chegar na etapa da conta,
  e me lembre de rotacionar depois.
- Valide executando o diagrama, não só importando. Sem execução DONE, o app
  não está validado.
- Registre no playbook e no README da pasta o que você descobrir de novo,
  inclusive o que falhou e o que não deu para verificar.
```

Se não houver um app definido, troque a primeira linha por:

```
Vamos cadastrar o próximo app no TOTVS iPaaS. Me proponha candidatos a partir
da fila da seção 11 do playbook, priorizando autenticação fácil de obter, e
confirme comigo antes de começar.
```

## Apps

| App | Autenticação | Operações | Status |
|---|---|---|---|
| [brasilapi](./brasilapi) | `NO_AUTH` | 16 | importado e validado em diagrama |
| [asaas](./asaas) | `API_KEY` (header `access_token`) | 41 em 3 serviços | importado e validado em diagrama |
| [brevo](./brevo) | `API_KEY` (header `api-key`) | 68 em 4 serviços | importado e validado em diagrama |
| [trello](./trello) | `API_KEY` (query `key` + `token`) | 151 em 5 serviços | importado e validado em diagrama |
| [open-meteo](./open-meteo) | `NO_AUTH` | 9 em 9 serviços | importado e validado em diagrama |
| [whatsapp](./whatsapp) | `TOKEN` (Bearer) | 100 em 6 serviços | importado e validado em diagrama; entrega bloqueada pela Meta no número de teste (ver README) |
| [biodoc](./biodoc) | `TOKEN` (Bearer) | 12 em 3 serviços | importado e validado em diagrama (sandbox); só o serviço de auditoria exercitado — verificação facial depende de dado biométrico de teste (ver README) |

## Estrutura

```
IPAAS-PLAYBOOK.md            # referência de cadastro no iPaaS
<nome-do-app>/
├── openapi.json             # spec fonte, mantida com $ref (é esta que você edita)
├── openapi.ipaas.json       # GERADO - spec dereferenciada, é esta que o iPaaS importa
├── ipaas.json               # metadados de cadastro (app, ambientes, contas, serviços)
└── README.md                # como cadastrar e usar no iPaaS
tools/
├── tag_by_path.py           # injeta tags derivadas do path, quando a spec não tem
├── slice_spec.py            # recorta uma spec grande em specs menores, por tag
├── prepare_whatsapp.py      # normaliza a spec oficial da Meta (ver whatsapp/README.md)
├── dereference.py           # gera os *.ipaas.json a partir das specs fonte
└── dereference.mjs          # porta Node do dereference.py, para máquinas sem Python
```

Um app pode ter **várias specs, uma por serviço**, quando a API é grande. Nesse caso o nome carrega o domínio e cada uma gera seu próprio arquivo do iPaaS:

```
asaas/openapi-clientes.json    ->  asaas/openapi-clientes.ipaas.json
asaas/openapi-cobrancas.json   ->  asaas/openapi-cobrancas.ipaas.json
```

Nome da pasta em minúsculas com hífen: `brasilapi`, `asaas`, `sendgrid`.

## Fluxo de trabalho

Quando a API **já tem OpenAPI oficial** (caso do Asaas), recorte por tag e dereferencie:

```bash
curl -sL "<url da spec oficial>" -o /tmp/spec.json
python3 tools/slice_spec.py /tmp/spec.json <app> "Tag A=slug-a" "Tag B=slug-b"
python3 tools/dereference.py <app>
```

Quando **não há spec** (caso da BrasilAPI), escreva o `openapi.json` à mão derivando os schemas de chamadas reais e depois rode:

```bash
python3 tools/dereference.py <app>     # um app
python3 tools/dereference.py --all     # todos
```

O `dereference.py` existe porque o importador do iPaaS **não resolve `$ref`** — sem a dereferência, os campos da resposta se perdem e viram um único campo `response` do tipo string. Ele também remove `securitySchemes` com `in: query`, que fazem a importação falhar com HTTP 500, valida os requisitos do importador e avisa sobre operações sem `tags` ou `summary`.

## URL de importação

```
https://raw.githubusercontent.com/dugabriel/ipaas-api-docs/main/<app>/openapi.ipaas.json
```

Use `openapi.ipaas.json`, **não** `openapi.json`.

## Convenções das specs

Escreva specs **recortadas por domínio** em vez de copiar a spec oficial inteira. APIs grandes (Stripe, GitHub, Salesforce) têm centenas de endpoints e um serviço com todos eles fica inutilizável na interface do iPaaS. Prefira vários serviços pequenos e coerentes no mesmo app.

Derive os schemas de **respostas reais** da API, não da documentação. Divergência entre doc e comportamento é comum, e o contrato importado é o que os fluxos de integração vão usar. Se um endpoint estiver indisponível, deixe-o fora em vez de documentar sem verificar.

`tags` e `summary` em toda operação. O iPaaS usa esses campos para nomear o recurso importado e a ausência de `tags` faz a importação falhar.

Documente as respostas de erro. Quem constrói a integração precisa saber o formato para tratar falhas.

Não versione credenciais. As contas são cadastradas na interface do iPaaS; `ipaas.json` descreve apenas o **tipo** de autenticação.
