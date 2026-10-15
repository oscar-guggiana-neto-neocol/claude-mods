# og-ticket — design

The work item the person is on, set by hand (or by Claude when asked), shown on the status
line. No tracker integration: the item comes from wherever the person read it — a Jira ticket,
a document, a spreadsheet row.

## Focus

A focus is an optional ID and a description, kept per project in `$.store` under
`project:<root>`, where the root is the git root of the session's directory, or the directory
itself outside git. It survives across sessions.

- `/og-ticket <ID> <description>` sets it. The first word is the ID when it looks like one
  (`[A-Z][A-Z0-9]+-\d+`, e.g. `SFCOMPRG-1234`); otherwise the whole text is the description.
- `/og-ticket` shows the focus; `/og-ticket clear` removes it.
- The `og_ticket_set` tool (`{ id?, description }`) lets Claude set it, e.g. after reading a
  ticket or a document the person points at. No confirmation: it is local state, visible at
  once on the status line.

## Status line

`$.ui.status`, one line per plugin, beside `og-sf-org-status`'s:

- With an ID: `🎫 SFCOMPRG-1234 · Quote sync fails on renewal`
- Without: `🎫 Quote sync fails on renewal`
- No focus: cleared.

Cut to 60 characters with `…`. Read at `session.start` and after every change.

## Layout

`mods/og-ticket/`: `hooks/focus.ts` (pure: parse the command text, the status text),
`hooks/register.tsx` (session start, command, tool, store), `types/index.d.ts`, tests beside
each, a README, and an entry in `.claude-plugin/marketplace.json`.

## Out of scope

Any tracker integration (reading or commenting on Jira), the branch as a source, the focus in
the system prompt. Each can come later.
