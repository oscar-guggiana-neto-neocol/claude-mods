# og-sf-soql

SOQL results as a table in a pane, instead of JSON or a wrapped text table in the transcript.

## Claude's queries

Every `sf data query` (or `sfdx force:data:soql:query`) Claude runs fills the pane: from its
`--json` or `-r csv` output, or, for the default human table, from the same query run again with
`--json` (a read). Claude still gets the full result; the transcript shows one line:

```
📋 42 records · Account · /og-soql to see
```

## `/og-soql`

| Command | Does |
| --- | --- |
| `/og-soql` | Opens the pane on the last result |
| `/og-soql SELECT …` | Runs the query against the target org |
| `/og-soql -o qa SELECT …` | Against another org |
| `/og-soql -t SELECT … FROM ApexClass` | Through the Tooling API |

## The pane

Columns fit the width and long values are cut with `…`; relationship fields are flattened
(`Owner.Name`) and subqueries show their count (`[3]`).

| Key | Does |
| --- | --- |
| Tab, Enter | Move between rows, open one: every field, uncut |
| `o` | In a record: open it in the browser (`sf org open --path /<Id>`) |
| `b` | Back to the table |
| `m` | Copy the table as Markdown (pastes as a table in Jira) |
| `v` | Copy it as CSV |
| Esc | Close |

## Install

```sh
/plugin install og-sf-soql --marketplace oscar-guggiana-neto-neocol/claude-mods
```
