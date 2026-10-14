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

`/og-sf-org <alias>` troca o alvo direto, sem abrir o painel.

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
