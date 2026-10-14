# og-sf-org-status

The project's target Salesforce org, always in sight, and a panel to switch between the project's orgs.

## What it does

**Status line:** `SF 🔴 PROD · RevCloudDemo` · `SF 🟡 sandbox · globexqa` · `SF 🟢 scratch · rac-demo4` · `SF 🔵 dev-ed · SF-DEV-ORG`.
Outside a Salesforce DX project (no `sfdx-project.json` above the cwd), nothing shows.

**Warning band:** when the target org is production, a `⚠ PRODUCTION` band shows above the prompt,
with **Switch** (opens the panel) and **Hide** (gone until the target changes).

**Panel (`/og-sf-org`):** shows the target org at the top (alias, kind, username, instance and
where the target comes from), then lists the project's orgs with kind, username and the selected
org's info (edition, API version, pod, connection status, expiration and org id). Where no panel can
be drawn, the command prints the target org as text instead. A gradient bar above and below frames
the panel, in Neocol colors that follow the target: aqua to purple when free, yellow to salmon when
protected, salmon to red in production. Keys with the panel focused:

| Key | Action |
| --- | --- |
| `t` | Make target: `sf config set target-org=<alias>` in the project |
| `o` | Open in browser: `sf org open -o <username>` |
| `i` | Refresh info |
| `e` | Edit list: every authenticated org, grouped by domain, to check the project's ones |
| `s` | Save list |
| `p` | Protect / unprotect the org (on production: downgrade, by typing the alias) |
| `r` | Restore production on a downgraded org |

`/og-sf-org <alias>` switches the target directly, without opening the panel.

## Protected org guard

Write commands Claude runs through the Bash tool, or the PowerShell tool on Windows, against a
protected org stop for you to confirm. This does not apply to what you run in your own terminal.

**Levels.** The mark belongs to the org (username) and holds in every project.

| Level | How an org gets there | Confirmation |
| --- | --- | --- |
| Production | Every org classified as production, by default | Alert beep and a dialog under a red `⚠ PRODUCTION · ALIAS` band. Only the alias typed under *Other* allows it; any other answer, or Esc, denies. Covers one command only. |
| Protected 🔒 | `p` in the panel, or automatic on a sandbox whose alias or username suffix names an environment: uat, qa, stg, staging, preprod, full, partial (`auto`) | Dialog: **Allow once**, **Allow for 15 min** (that org only, this session; dropped if the target org changes) or **Deny** |
| Free | The rest, or `p` on a protected one | None |

A demo, SDO or Trailhead Playground org shows as production. `p` downgrades it (asks for the typed
alias) and it becomes protected, shown as `PROD↓`; `r` restores it. The status line shows `🔒` on
protected orgs.

**What counts as a write.** `sf project deploy start/quick/resume` (not `validate`, nor
`--dry-run`), `project delete source`, `data create/update/delete/upsert/import/bulk`, `apex run`
(not `apex run test`), `package install`, `org assign permset`, `org delete`, `api request rest`
with a method other than GET (`--method`/`-X`), `api request graphql`, and the `sfdx force:*`
equivalents. Reads (`query`, `retrieve`, `org display/open`, logs) pass freely. The org comes from
`-o`/`--target-org` (or `-u`), case-insensitive; with no flag, it is the project's target org.

**Indirect paths.** The parser follows chained commands (`&&`, `;`, `|`, `$(...)`) and
`bash -c '...'`, `pwsh -Command`, `cmd /c`, and reads PowerShell syntax (paths with `\`,
`& "...\sf.cmd"`, the backtick as escape and line continuation). A command that names the alias,
username or URL of a protected org (a `curl` to the REST API, for instance) asks too, and so do
project scripts named deploy, push, release, data, seed, apex or migrate (`npm run deploy:uat`,
`./scripts/deploy.sh`) when the target org is protected. The system prompt lists the project's
protected orgs and tells Claude not to work around the guard.

**When nobody can answer** (`claude -p`, SDK), the write is denied. If the guard fails while
deciding on a write command, it denies (fails closed). MCP servers that write to orgs are out of
scope.

**Windows.** Works the same, with one difference: Claude Code plays no sounds on Windows, so the
production alert is visual only. The home folder comes from `USERPROFILE` when `HOME` is unset, and
the mod runs the sf CLI through `cmd /c` (`sf.cmd` must be on the Claude process's PATH for the
panel to show org info and switch the target; the status line and the guard read files and do not
depend on it).

## Where the project's orgs come from

1. **Saved list:** kept in the mod's store (in your user), keyed by the project path. Nothing is
   written to the client's repo.
2. **Inferred:** with no saved list, the panel shows the target org and the other authenticated
   orgs of the same username domain (`@globex.com.globexdev` and `@globex.com.globexqa` →
   `globex.com`). Generic scratch domains (`example.com`) are left out. **Save list** pins the result.

## Resolving the target org

Follows the sf CLI's precedence: `SF_TARGET_ORG` (or `SFDX_DEFAULTUSERNAME`) in Claude's process,
then the project's `.sf/config.json`, then the global `~/.sf/config.json`. The legacy
`.sfdx/sfdx-config.json` files are read too. Aliases come from `~/.sfdx/alias.json`. The org kind
comes from the auth file `~/.sfdx/<username>.json`: it uses `isScratch`/`isSandbox` and, when they
are missing, infers from the URL.

The status line refreshes at session start, after each `sf`/`sfdx` command of the Bash or
PowerShell tool, and every 15 s (catching changes made in another terminal).

Demo, SDO and Trailhead Playground orgs show as PROD or dev-ed, because technically they are
production orgs.
