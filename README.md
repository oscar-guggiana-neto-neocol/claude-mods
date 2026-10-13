# claude-mods

Mods do Claude Code, um por pasta em `mods/`. O repo é também um marketplace
(`.claude-plugin/marketplace.json`), então cada mod se instala no escopo do usuário
e passa a valer em todos os projetos.

| Mod | Tipo | O que faz |
| --- | --- | --- |
| [sf-org-status](mods/sf-org-status) | status line, painel, faixa, `/sf-org` | Org Salesforce alvo à vista, troca entre as orgs do projeto e alerta em produção |
| [focus-mode](mods/focus-mode) | render hooks, `/foco` | Interface mais limpa: ferramentas em uma linha, resultados só em erro, sem rodapés de turno |

## Instalar (uma vez)

```sh
claude plugin marketplace add ~/Documents/Coding/claude-mods
claude plugin install sf-org-status@oscar-claude-mods --scope user
claude plugin install focus-mode@oscar-claude-mods --scope user
```

O marketplace é uma pasta local e cada `source` é um caminho relativo, então o
Claude Code lê os mods direto daqui. Depois de editar um mod, rode `/reload-plugins`
na sessão. Não precisa reinstalar.

## Desenvolver

```sh
claude --plugin-dir mods/<mod> --debug   # recarrega a cada save
scripts/check.sh                         # valida o marketplace, valida e testa todos os mods
```

Um mod novo precisa de `mods/<nome>/.claude-plugin/plugin.json`, `hooks/hooks.json`
e o hooks module, além de uma entrada em `.claude-plugin/marketplace.json`.
