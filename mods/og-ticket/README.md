# og-ticket

The work item you are on, in sight: an optional ID and a short description on the status line,
kept per project across sessions. No tracker integration: set it from whatever you read, a Jira
ticket, a document, a spreadsheet row.

```
🎫 SFCOMPRG-1234 · Quote sync fails on renewal
```

| Command | Does |
| --- | --- |
| `/og-ticket <ID> <description>` | Sets the focus. The first word is the ID when it looks like one (`SFCOMPRG-1234`, `PLA-41`); otherwise the whole text is the description |
| `/og-ticket` | Shows the focus |
| `/og-ticket clear` | Removes it |

Claude can set it too, through the `og_ticket_set` tool (`{ id?, description }`): ask it to read
a ticket or a document and set the focus. The status line shows the result at once.

The project is the git root of the session's directory, or the directory itself outside git.
The line is cut to 60 characters.

## Install

```sh
/plugin install og-ticket --marketplace oscar-guggiana-neto-neocol/claude-mods
```
