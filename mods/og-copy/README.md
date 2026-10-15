# og-copy

Copy what Claude wrote as clean Markdown, without the terminal's line wraps and indentation:
ready to paste into a Jira ticket, an email or a document.

## `/og-copy`: pick the blocks

Opens a pane on Claude's last response, split into numbered blocks: paragraphs, headings, each
list item (with its nested items), tables and code blocks, each whole.

| Key | Does |
| --- | --- |
| Tab, Enter | Move, check or uncheck a block |
| `c` | Copy the checked blocks, or the whole response when none is checked |
| `a` | Check or uncheck all |
| `p` / `n` | Previous / next response |
| Esc | Close |

A response is everything Claude wrote in one turn, tool calls left out. Where no pane can be
drawn, `/og-copy` copies the whole last response.

## Ask Claude: `og_copy`

For a part that is not a whole block, or a rewrite for where it goes, ask in words: "copy only
the error table", "copy this as a short Jira comment". Claude calls the `og_copy` tool with the
text, and a toast says what was copied.

## Clipboard

`pbcopy` on macOS, `Set-Clipboard` on Windows, `wl-copy` or `xclip` on Linux.

## Install

```sh
/plugin install og-copy --marketplace oscar-guggiana-neto-neocol/claude-mods
```
