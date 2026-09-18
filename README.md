# DevPulse

A local desktop dock for Windows that watches your AI coding tool usage — quota, runtime status, and activity — without sending anything anywhere. Everything runs on `127.0.0.1`.

## Screenshot

> _Screenshot coming soon._

## O que monitora

| Provider | Tipo de dado | O que o DevPulse mostra |
|---|---|---|
| **Codex** (OpenAI) | quota | % de uso das janelas de limite (5h e semanal), plano, créditos de reset |
| **Claude** (Anthropic) | quota | % de uso das janelas de limite (5h e semanal), breakdown semanal, extra usage |
| **Ollama** | runtime | online/offline, versão, modelos instalados e carregados no momento |
| **OpenCode** | activity | versão, providers configurados, sessões/mensagens dos últimos 7 dias |
| **Gemini** | detection | instalado/autenticado ou não — sem endpoint local oficial de uso confirmado, nenhum percentual é inventado |
| **Cursor** | detection | instalado ou não, versão quando disponível — sem endpoint local oficial de uso confirmado |

Diferença entre as categorias:

- **quota** — o provider tem um limite de uso real, consultável, e o DevPulse mostra o percentual oficial retornado pela própria API do provider.
- **runtime** — não existe "quota"; o que existe é um serviço local rodando ou não, com estado observável (versão, modelos).
- **activity** — contagem de uso do próprio cliente (sessões, mensagens) — nunca somada ao consumo de outro provider, para não contar duas vezes.
- **detection** — o DevPulse apenas confirma que a ferramenta está instalada/autenticada. Nenhum percentual de uso é exibido quando não existe uma fonte oficial confirmada para isso.

O DevPulse nunca inventa métricas. Se um provider não expõe um dado real, o DevPulse simplesmente não mostra esse dado.

## Requisitos

- Windows 10/11
- [Node.js](https://nodejs.org) 18 ou mais recente (testado nesta máquina de desenvolvimento com Node 24; versões mínimas mais antigas não foram validadas)
- Microsoft Edge (usado para abrir o Pulse em modo `--app`, sem abas/barra de endereço)

Nenhuma dependência de terceiros é necessária hoje — o backend usa apenas módulos nativos do Node.js (`http`, `fs`, `path`, `child_process`, `os`).

## Instalação

### Opção ZIP

1. Baixe o código (Download ZIP)
2. Extraia em qualquer pasta
3. Execute `DevPulse.bat`

### Opção Git

```
git clone https://github.com/mayconmalmeida/DevPulse.git
cd DevPulse
DevPulse.bat
```

`DevPulse.bat` verifica Node.js e Microsoft Edge, inicia o servidor local se ele ainda não estiver rodando, e abre o Pulse. Se alguma dependência estiver faltando, uma mensagem clara é exibida — nada é instalado silenciosamente além de eventuais dependências do próprio projeto via `npm install` (hoje, nenhuma).

## Privacidade

- O DevPulse roda inteiramente em `127.0.0.1` — não existe backend remoto próprio.
- Todos os dados gerados (histórico de quota, atividade, alerts) ficam em arquivos locais na pasta `data/`, nunca são enviados para nenhum servidor.
- Para Codex e Claude, o DevPulse **lê** (nunca modifica) as credenciais de sessão que o próprio CLI oficial já salvou localmente (`~/.codex/auth.json`, `~/.claude/.credentials.json`) para consultar as APIs oficiais de uso de cada provider. O DevPulse nunca faz login em nome do usuário e nunca grava/altera essas credenciais.
- Tokens de acesso são usados apenas no processo do servidor, para montar o cabeçalho `Authorization` de uma chamada HTTP de leitura — nunca são enviados ao frontend (pulse.js/app.js) nem persistidos em `data/`.
- Ollama, OpenCode, Gemini e Cursor são consultados via API local (Ollama) ou subcomandos/arquivos de detecção locais (OpenCode, Gemini, Cursor) — nenhum deles envolve autenticação gerenciada pelo DevPulse.

## Alerts

O DevPulse tem um sistema de alertas local, com thresholds próprios:

- **70%** = atenção (warning)
- **90%** = crítico (critical)

**Esses limiares são do DevPulse, não uma classificação oficial dos providers.** Eles existem só para chamar atenção do usuário dentro do próprio DevPulse — Codex e Claude não categorizam seu próprio uso dessa forma.

Alertas de saúde (offline/instável) existem para runtimes locais como o Ollama. Nenhum evento normal de atividade (como carregar um modelo no Ollama) vira alerta — alerta é reservado para condições que realmente merecem atenção.

Notificações nativas do Windows (balloon tip) são opcionais e configuráveis, e usam apenas `System.Windows.Forms.NotifyIcon` (.NET Framework já presente no Windows) — nenhuma instalação adicional.

## Data

Arquivos locais gerados automaticamente em `data/` (criados no primeiro uso, nunca distribuídos com o projeto):

| Arquivo | Conteúdo |
|---|---|
| `data/history.jsonl` | histórico de snapshots de quota (Codex/Claude), um por captura |
| `data/activity.jsonl` | eventos de atividade detectados (mudança de quota, online/offline, modelo carregado) |
| `data/alerts.jsonl` | histórico de estado dos alertas (criado/escalado/resolvido) |
| `data/alerts-config.json` | configuração local dos alerts (thresholds, notificações ligadas/desligadas) |

Nenhum desses arquivos guarda tokens, senhas ou qualquer credencial — apenas percentuais, timestamps e metadados já sanitizados.

## Segurança

- Princípio **read-only** em relação às sessões dos providers: o DevPulse lê arquivos de credencial existentes só para autenticar chamadas HTTP de leitura; nunca escreve, renova ou revoga uma sessão.
- O servidor local só aceita conexões em `127.0.0.1` — não fica exposto na rede.
- Todo dado persistido passa por uma etapa de sanitização com whitelist de campos antes de ser gravado em disco.

## Limitações

- **Windows-first.** Os mecanismos de detecção (`LOCALAPPDATA`, `APPDATA`, janela nativa via Win32) são específicos do Windows; o projeto não foi validado em macOS/Linux.
- Cada provider depende de estar instalado e, quando aplicável, autenticado localmente — o DevPulse não instala nem autentica nada por conta própria.
- Gemini e Cursor hoje só têm detecção (instalado/não instalado); nenhuma API local oficial de quota foi confirmada para eles nesta auditoria.

## Desenvolvimento

```
npm install
npm start
```

(`npm install` hoje não instala nada, já que o projeto não tem dependências externas — o comando existe para consistência com qualquer dependência futura.)

Testes:

```
npm test
```

## Licença

DevPulse é distribuído sob a [MIT License](LICENSE).
