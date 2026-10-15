# claude-mods

Claude Code mods, one per folder in `mods/`. The repo is also a marketplace
(`.claude-plugin/marketplace.json`), so each mod installs at user scope and applies to every
project.

| Mod | Kind | What it does |
| --- | --- | --- |
| [og-sf-org-status](mods/og-sf-org-status) | status line, panel, band, `/og-sf-org` | The target Salesforce org in sight, switching between the project's orgs, and a write guard for protected and production orgs |
| [og-focus-mode](mods/og-focus-mode) | render hooks, `/og-focus` | A cleaner interface: tools on one line, results only on error, no turn footers |
| [og-themes](mods/og-themes) | themes, panel, `/og-theme` | Neocol and LaGana Lion themes, dark and light, per project, switched live by number |
| [og-ticket](mods/og-ticket) | hint line, tool, `/og-ticket` | The work item in focus (ID and description) per project, set by hand or by Claude |
| [og-copy](mods/og-copy) | panel, tool, `/og-copy` | Copy Claude's responses as clean Markdown, whole or block by block, or a part Claude picks |

## Install

```sh
claude plugin marketplace add oscar-guggiana-neto-neocol/claude-mods
claude plugin install og-sf-org-status@oscar-claude-mods --scope user
claude plugin install og-focus-mode@oscar-claude-mods --scope user
claude plugin install og-themes@oscar-claude-mods --scope user
claude plugin install og-ticket@oscar-claude-mods --scope user
claude plugin install og-copy@oscar-claude-mods --scope user
```

Use `--scope project` to enable a mod for one project only. To update:
`claude plugin marketplace update oscar-claude-mods`, then `claude plugin update <mod>@oscar-claude-mods`.

When developing, add the local clone instead (`claude plugin marketplace add ~/Documents/Coding/claude-mods`):
each `source` is a relative path, so Claude Code reads the mods straight from the folder. After
editing a mod, run `/reload-plugins` in the session; no reinstall needed.

## Develop

```sh
claude --plugin-dir mods/<mod> --debug   # reloads on every save
scripts/check.sh                         # validates the marketplace, validates and tests every mod
```

A new mod needs `mods/<name>/.claude-plugin/plugin.json`, `hooks/hooks.json` and the hooks module,
plus an entry in `.claude-plugin/marketplace.json`.
