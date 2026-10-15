# og-copy — design

Copy what Claude wrote as clean Markdown, in full or in part, without the terminal's line wraps
and indentation, ready to paste into a Jira ticket or anywhere else.

## A. The panel: `/og-copy`

Opens a focused pane (Esc closes) on Claude's last response, split into numbered blocks:

- a fenced code block, whole;
- a table (consecutive `|` lines), whole;
- a heading;
- each top-level list item, with its continuation lines and nested items;
- each paragraph (lines up to a blank line).

Each block is one row: `[x] 3  <first line, cut to the pane width>` plus a dim hint for long
blocks (`(12 lines)`). Tab moves, Enter checks/unchecks, `c` copies the checked blocks (all of
them when none is checked), `a` checks or unchecks all, `p`/`n` move to the previous/next
response. The copied text is the blocks' Markdown joined by a blank line. After copying, a toast
says how much was copied and the pane closes.

Responses are the assistant messages with text, newest first; tool calls and their output are
not part of them. Where no pane can be drawn, `/og-copy` copies the whole last response and says
so.

## B. The tool: `og_copy`

`og_copy({ text })` copies the given text to the clipboard. Claude calls it when the user asks
in words ("copy only the error table", "copy this as a short Jira comment"). No confirmation: the
clipboard is local, and a toast says what was copied.

## Clipboard

macOS `pbcopy`; Windows `powershell -NoProfile -Command Set-Clipboard` (stdin); Linux `wl-copy`,
then `xclip -selection clipboard`. Text goes on stdin. A failure is reported, never silent.

## Layout

`mods/og-copy/`: `hooks/blocks.ts` (pure: split Markdown into blocks, join, row preview),
`hooks/register.tsx` (command, pane, tool, clipboard), `types/index.d.ts`, tests, README, and the
marketplace entry. Version `0.1.0`.

## Out of scope

Converting Markdown to Jira wiki markup (the Jira editor accepts pasted Markdown; the tool can
ask Claude to reformat), selecting part of a block, copying tool output.
