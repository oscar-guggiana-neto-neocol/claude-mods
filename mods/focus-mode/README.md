# focus-mode

Uma interface do terminal mais limpa, alternada com `/foco`. A escolha fica lembrada entre sessões,
e o rodapé mostra `foco` enquanto o modo está ligado.

| Com o modo ligado | |
| --- | --- |
| Chamadas de ferramenta | Uma linha esmaecida: `· Bash git status`, `· Read src/org.ts`, `· jira · jira_get_issue` (`◦` enquanto roda) |
| Edições (Edit/Write) | Uma linha com contagem: `· Edit src/org.ts +12 −3` |
| Resultados | Escondidos, exceto quando a chamada falha |
| Erros e interrupções | A linha completa do Claude Code, como sempre |
| `Baked for 3s`, avisos sob o logo | Escondidos |
| `? for shortcuts` | Escondido quando ocioso (`esc to interrupt` continua durante o turno) |

Fora do alcance de um mod: as linhas de saída de hooks (`SessionStart:startup hook success`) e os
blocos de sistema. O transcript completo (ctrl+o) também fica compacto com o modo ligado. Para ver
tudo, desligue com `/foco`.
