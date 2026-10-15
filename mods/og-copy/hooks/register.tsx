import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { View } from '../types'
import { joinBlocks, previewOf, splitBlocks } from './blocks'

const PLUGIN = 'og-copy'
const COMMAND = 'og-copy'
const TOOL = 'og_copy'
const PANE = 'og-copy'

const view = atom({ plugin: 'og-copy', key: 'view' } as const, null)

/**
 * Claude's responses, newest first: the text of each turn's assistant messages,
 * joined. A prompt the person typed starts a turn; tool results do not.
 */
async function responsesOf($: EngineInterface): Promise<string[]> {
  const messages = await $.session.messages()
  const turns: string[][] = []
  for (const message of messages) {
    if (message.role === 'user' && message.text.trim() !== '') turns.push([])
    if (message.role === 'assistant' && message.text.trim() !== '') {
      if (turns.length === 0) turns.push([])
      turns[turns.length - 1]?.push(message.text.trim())
    }
  }

  return turns.map(texts => texts.join('\n\n')).filter(text => text !== '').reverse()
}

/** Puts text on the system clipboard: pbcopy, Set-Clipboard on Windows, wl-copy or xclip on Linux. */
async function toClipboard($: EngineInterface, text: string) {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const commands = isWindows
    ? [['powershell', '-NoProfile', '-Command', '[Console]::In.ReadToEnd() | Set-Clipboard']]
    : [['pbcopy'], ['wl-copy'], ['xclip', '-selection', 'clipboard']]
  for (const argv of commands) {
    const ran = await $.process.run(argv, { stdin: text }).catch(() => undefined)
    if (ran?.exitCode === 0) return
  }
  throw new Error('no clipboard command worked (pbcopy, wl-copy, xclip, Set-Clipboard)')
}

const sizeOf = (text: string) => `${text.length} characters`

/** Copies the checked blocks of the shown response (all of them when none is checked), then closes the pane. */
async function copyChecked($: EngineInterface) {
  const shown = await read($, view)
  const response = shown?.responses[shown.index]
  if (shown === null || response === undefined) return
  const blocks = splitBlocks(response)
  const picked = shown.checked.length === 0 ? blocks : blocks.filter((_, i) => shown.checked.includes(i))
  const text = joinBlocks(picked)
  try {
    await toClipboard($, text)
    $.ui.toast(`Copied ${picked.length} of ${blocks.length} blocks (${sizeOf(text)}).`)
    await $.ui.close({ id: PANE })
  } catch (error) {
    $.ui.toast(`og-copy: ${String(error instanceof Error ? error.message : error)}`)
  }
}

const toggle = (list: number[], i: number) => (list.includes(i) ? list.filter(one => one !== i) : [...list, i].sort((a, b) => a - b))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: COMMAND,
      description: "Copy Claude's last response, or some of its blocks, as Markdown",
    })
    await $.tool.register({
      name: TOOL,
      description:
        "Copies text to the user's clipboard. Use it when the user asks you to copy something: a part of your response (only the table, only the summary) or a version of it rewritten for where they will paste it (a Jira comment, an email). Pass the exact Markdown to copy.",
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    })

    return started
  })

  on('command.run', { command: COMMAND }, async $ => {
    const responses = await responsesOf($)
    if (responses.length === 0) return { text: 'No response to copy yet.' }
    await update($, view, () => ({ responses, index: 0, checked: [] }))
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Copy', focus: true, closeOnEscape: true })
    if (isPlaced) return {}
    // No pane to choose in: the whole last response.
    const text = responses[0] as string
    await toClipboard($, text)

    return { text: `Copied the last response (${sizeOf(text)}).` }
  }).catch(($, e) => ({ text: `og-copy: ${String(e)}` }))

  on('tool.call', { tool: `mcp__${PLUGIN}__${TOOL}` }, async ($, e) => {
    const text = String((e as { text?: unknown }).text ?? '')
    if (text.trim() === '') return { deny: 'Nothing to copy: the text is empty.' }
    try {
      await toClipboard($, text)
    } catch (error) {
      return { deny: `Not copied: ${error instanceof Error ? error.message : String(error)}` }
    }
    $.ui.toast(`Copied ${sizeOf(text)}.`)

    return { result: `Copied to the clipboard (${sizeOf(text)}).` } as never
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, view, () => null)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const shown = await read($, view)
    const response = shown?.responses[shown.index]
    if (shown === null || response === undefined) return <Text dimColor>Nothing to copy.</Text>
    const blocks = splitBlocks(response)
    const width = Math.max(20, (e.props.bodyColumns ?? 80) - 16)
    const setView = (fn: (one: View) => View) => update($, view, one => (one === null ? one : fn(one)))
    const move = (by: number) => setView(one => ({ ...one, index: one.index + by, checked: [] }))
    const allChecked = shown.checked.length === blocks.length

    return (
      <Box flexDirection="column">
        <Text dimColor>
          Response {shown.index + 1} of {shown.responses.length} (1 is the latest) · Tab moves · Enter checks · c copies the checked
          blocks, or all when none is
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {blocks.map((block, i) => {
            const { line, more } = previewOf(block, width)
            return (
              <Button key={`block:${i}`} plain onPress={() => setView(one => ({ ...one, checked: toggle(one.checked, i) }))}>
                {shown.checked.includes(i) ? '[x]' : '[ ]'} <Text dimColor>{String(i + 1).padStart(2)}</Text> {line}
                {more ? <Text dimColor> ({more})</Text> : ''}
              </Button>
            )
          })}
        </Box>
        <Box marginTop={1} gap={1}>
          <Button
            key="copy"
            label={shown.checked.length === 0 ? 'Copy all' : `Copy ${shown.checked.length}`}
            hotkey="c"
            variant="primary"
            onPress={() => copyChecked($)}
          />
          <Button
            key="all"
            label={allChecked ? 'Uncheck all' : 'Check all'}
            hotkey="a"
            onPress={() => setView(one => ({ ...one, checked: allChecked ? [] : blocks.map((_, i) => i) }))}
          />
          {shown.index + 1 < shown.responses.length && <Button key="prev" label="Previous" hotkey="p" onPress={() => move(1)} />}
          {shown.index > 0 && <Button key="next" label="Next" hotkey="n" onPress={() => move(-1)} />}
        </Box>
      </Box>
    )
  })
}
