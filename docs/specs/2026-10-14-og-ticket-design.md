# og-ticket — design

The work item in focus for the project, on the status line, and a confirmed way to comment on
it. The tracker varies by project: Jira through the Atlassian CLI (`acli`), Jira through the
Atlassian Rovo connector of claude.ai, or none at all (`manual`).

## Focus

The focus of a project is, in order:

1. A focus pinned with `/og-ticket <key or text>`, kept per project in `$.store`.
2. The key in the current branch name, matched by `[A-Z][A-Z0-9]+-\d+`
   (`feature/SFCOMPRG-1234-quote-sync` → `SFCOMPRG-1234`).
3. Nothing: the status line is cleared.

`/og-ticket <text>` pins a key when the text is one, and otherwise a free-text focus
(`manual`). `/og-ticket clear` removes the pin, so the branch decides again.

The branch is read at `session.start`, after each Bash/PowerShell call that runs `git`,
and on a one-minute clock, like `og-sf-org-status` does for the org. The project is the git
root of the session's working directory, or the directory itself outside git.

## Sources

Each project has one source, stored in `$.store` under the project:

| Source   | Reads the item                                       | Comments                                                  |
| -------- | ---------------------------------------------------- | --------------------------------------------------------- |
| `acli`   | `acli jira workitem view <key> --json` (`$.process`) | `acli jira workitem comment create --key <key> --body …`  |
| `rovo`   | Rovo `getJiraIssue` with `cloudId` (`$.tool.call`)   | Rovo `addCommentToJiraIssue`                              |
| `manual` | nothing: the pinned text is the item                 | none                                                      |

`/og-ticket source acli|rovo|manual` sets it. With none set and a key in focus, the mod tries
`acli` (when installed and it finds the key), then Rovo (each accessible `cloudId` in turn),
and stores the first that answers, with the `cloudId` for Rovo. When neither finds the key,
nothing is stored and the line shows the key alone. A project with a free-text focus is
`manual`.

The exact `acli` JSON and the Rovo tool schemas are confirmed against the real tools before
the adapters are written (both need the user's login first).

## Status line

`$.ui.status`, one line per plugin, so it sits beside `og-sf-org-status`'s:

- Jira item: `🎫 SFCOMPRG-1234 · In Progress · Quote sync fails on…` (summary cut to fit ~60 chars)
- Key not found or tracker unreachable: `🎫 SFCOMPRG-1234 · ?`
- Manual: `🎯 <text, cut to ~60 chars>`

An item is cached for 5 minutes and fetched again when the focus changes. A failed fetch never
raises an error on screen.

## Comment

`/og-ticket comment` (only for `acli` and `rovo`; for `manual` it answers that the project has
no tracker) submits a prompt to the session's Claude: draft a short comment of what was done
in this session for `<key>` (what changed, why, what is pending), in the language of the
ticket, and post it with the `og_ticket_comment` tool.

`og_ticket_comment` is a tool the mod declares (`$.tool`), taking `{ body }`. It posts only to
the item in focus. Before posting it shows the body with `$.ui.ask` — **Post / Cancel** — in
every permission mode, auto mode included; with nobody to ask it refuses. Then it posts
through the project's source and returns the result to Claude. The user can ask Claude for
changes before confirming; a new draft is a new call and a new confirmation.

## Commands

| Command                           | Does                                        |
| --------------------------------- | ------------------------------------------- |
| `/og-ticket`                      | Shows the focus, its source and status      |
| `/og-ticket <key or text>`        | Pins the focus for the project              |
| `/og-ticket clear`                | Removes the pin                             |
| `/og-ticket source <acli\|rovo\|manual>` | Sets the project's source            |
| `/og-ticket comment`              | Asks Claude for a comment draft             |

## Layout

`mods/og-ticket/`, like the other mods: `hooks/focus.ts` (pure: key from branch, pin vs
branch, status text), `hooks/sources.ts` (the `acli` and Rovo adapters behind one interface:
`fetch(key)`, `comment(key, body)`), `hooks/register.tsx` (events, command, tool, store),
`types/index.d.ts`, tests beside each, and an entry in `.claude-plugin/marketplace.json`.

## Tests

- Unit: key from branch names, pin precedence, status text and truncation, free text vs key.
- Integration with `acli` and Rovo mocked: fetch and cache, branch switch, source discovery
  and memory, unreachable tracker, comment confirmed / cancelled / nobody to ask, `manual`
  refusing to comment.

## Out of scope

Changing status (transitions), opening in the browser, the item in the system prompt, and
spreadsheet trackers. Each can come later as a source or a command.
