# og-sf-org-status

A org Salesforce alvo do projeto, sempre à vista, e um painel para trocar entre as orgs do projeto.

## O que faz

**Status line:** `SF 🔴 PROD · RevCloudDemo` · `SF 🟡 sandbox · globexqa` · `SF 🟢 scratch · rac-demo4` · `SF 🔵 dev-ed · SF-DEV-ORG`.
Fora de um projeto Salesforce DX (sem `sfdx-project.json` acima do cwd), nada aparece.

**Faixa de alerta:** quando a org alvo é produção, uma faixa `⚠ PRODUÇÃO` aparece acima do prompt,
com **Trocar** (abre o painel) e **Ocultar** (some até o alvo mudar).

**Painel (`/og-sf-org`):** lista as orgs do projeto, com tipo, username e a info da org selecionada
(edição, versão da API, pod, status da conexão, expiração e org id). Atalhos com o painel focado:

| Tecla | Ação |
| --- | --- |
| `t` | Tornar alvo: `sf config set target-org=<alias>` no projeto |
| `o` | Abrir no browser: `sf org open -o <username>` |
| `i` | Atualizar info |
| `e` | Editar lista: todas as orgs autenticadas, agrupadas por domínio, para marcar as do projeto |
| `s` | Salvar lista |
| `p` | Proteger / desproteger a org (em produção: rebaixar, digitando o alias) |
| `r` | Restaurar produção numa org rebaixada |

`/og-sf-org <alias>` troca o alvo direto, sem abrir o painel.

## Guarda de orgs protegidas

Comandos de escrita que o Claude roda pela Bash tool numa org protegida param para você confirmar.
Isso não vale para o que você roda no seu próprio terminal.

**Níveis.** A marca é da org (username) e vale em todos os projetos.

| Nível | Como a org chega lá | Confirmação |
| --- | --- | --- |
| Produção | Toda org classificada como produção, por padrão | Bip de alerta e diálogo sob uma faixa vermelha `⚠ PRODUÇÃO · ALIAS`. Só o alias digitado em *Other* autoriza; qualquer outra resposta, ou Esc, nega. Vale para um comando só. |
| Protegida 🔒 | `p` no painel, ou automática numa sandbox cujo alias ou sufixo de username indique ambiente: uat, qa, stg, staging, preprod, full, partial (`auto`) | Diálogo: **Autorizar uma vez**, **Autorizar por 15 min** (só aquela org, nesta sessão; cai se a org alvo mudar) ou **Negar** |
| Livre | O resto, ou `p` numa protegida | Nenhuma |

Uma org de demo, SDO ou Trailhead Playground aparece como produção. `p` rebaixa (pede o alias digitado)
e ela vira protegida, mostrada como `PROD↓`; `r` restaura. A status line mostra `🔒` nas protegidas.

**O que é escrita.** `sf project deploy start/quick/resume` (não `validate`, nem `--dry-run`),
`project delete source`, `data create/update/delete/upsert/import/bulk`, `apex run` (não `apex run test`),
`package install`, `org assign permset`, `org delete`, e os equivalentes `sfdx force:*`. Leituras
(`query`, `retrieve`, `org display/open`, logs) passam livres. A org vem de `-o`/`--target-org`
(ou `-u`); sem flag, é a org alvo do projeto.

**Caminhos indiretos.** A análise entra em comandos encadeados (`&&`, `;`, `|`, `$(...)`) e em
`bash -c '...'`. Também pedem confirmação um comando que cite o alias, o username ou a URL de uma org
protegida (um `curl` na REST API, por exemplo), e scripts do projeto com nome de deploy, push,
release, data, seed, apex ou migrate (`npm run deploy:uat`, `./scripts/deploy.sh`) quando a org alvo
é protegida. O system prompt lista as orgs protegidas do projeto e pede ao Claude que não contorne a guarda.

**Quando ninguém pode responder** (`claude -p`, SDK), a escrita é negada. Se a guarda falhar ao
decidir sobre um comando de escrita, ela nega (falha fechada). Os MCPs que escrevem em orgs ficam
fora do escopo.

## De onde vêm as orgs do projeto

1. **Lista salva:** guardada no store do mod (no seu usuário), indexada pelo caminho do projeto.
   Nada é escrito no repo do cliente.
2. **Inferida:** sem lista salva, o painel mostra a org alvo e as outras orgs autenticadas do mesmo
   domínio de username (`@globex.com.globexdev` e `@globex.com.globexqa` → `globex.com`). Domínios
   genéricos de scratch (`example.com`) ficam de fora. Um clique em **Salvar lista** fixa o resultado.

## Resolução da org alvo

Segue a ordem de precedência do sf CLI: `SF_TARGET_ORG` (ou `SFDX_DEFAULTUSERNAME`) do processo do
Claude, depois o `.sf/config.json` do projeto, depois o global `~/.sf/config.json`. Os arquivos
legados `.sfdx/sfdx-config.json` também são lidos. Aliases vêm de `~/.sfdx/alias.json`. O tipo da
org vem do auth file `~/.sfdx/<username>.json`: usa `isScratch`/`isSandbox` e, quando faltam, deduz
pela URL.

A status line atualiza no início da sessão, depois de cada comando `sf`/`sfdx` da Bash tool e a cada
15 s (pega mudanças feitas em outro terminal).

Orgs de demo, SDO e Trailhead Playground aparecem como PROD ou dev-ed, porque tecnicamente são orgs
de produção.
