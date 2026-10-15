# og-sf-soql — design

SOQL results as a table in a pane instead of JSON or a wrapped text table in the transcript.

## Capture

Every Bash/PowerShell call that runs `sf data query` (or `sfdx force:data:soql:query`) is read
after it runs:

- `--json`: the records from the JSON; `--result-format csv`: from the CSV;
- the default human format: the same query is run again with `--json` for the pane (a read; the
  org guard does not ask).

Claude still receives the full result, unchanged. In the transcript the result row becomes one
line: `📋 42 records · Account · /og-soql to see`. A failed query keeps its normal row.

## `/og-soql`

- `/og-soql` opens the pane on the last result.
- `/og-soql SELECT …` runs the query against the target org; `-o <org>` picks another, `-t` uses
  the Tooling API. The result opens in the pane; an error is shown as the command's text.

## Pane

- Header: the query (one line, cut), the org when named, the record count.
- Table: columns fitted to the width, values cut with `…`; relationship fields flattened
  (`Owner.Name`); subqueries shown as a count (`[3]`). Tab moves between rows.
- Enter on a row shows the record vertically, every field uncut; `o` opens it in the browser
  (`sf org open --path /<Id>`), `b` goes back.
- `m` copies the table as Markdown (for Jira), `v` as CSV, through the system clipboard.

## Layout

`mods/og-sf-soql/`: `hooks/soql.ts` (pure: command parsing, records from JSON/CSV, flattening,
column fitting, Markdown/CSV), `hooks/register.tsx`, `types/index.d.ts`, tests, README,
marketplace entry. Version `0.1.0`.

## Out of scope

Sorting, history, editing records, paging beyond what `sf` returns.
