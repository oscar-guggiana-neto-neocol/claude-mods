# og-focus-mode

A cleaner terminal interface, toggled with `/og-focus`. The choice is remembered across sessions,
and the footer shows `og-focus` while the mode is on.

| With the mode on | |
| --- | --- |
| Tool calls | One dim line: `· Bash git status`, `· Read src/org.ts`, `· jira · jira_get_issue` (`◦` while running) |
| Edits (Edit/Write) | One line with counts: `· Edit src/org.ts +12 −3` |
| Results | Hidden, unless the call fails |
| Errors and interruptions | Claude Code's full row, as usual |
| `Baked for 3s`, notices under the logo | Hidden |
| `? for shortcuts` | Hidden while idle (`esc to interrupt` stays during a turn) |

Out of a mod's reach: hook output lines (`SessionStart:startup hook success`) and system blocks.
The full transcript (ctrl+o) is compact too while the mode is on. To see everything, turn it off
with `/og-focus`.
