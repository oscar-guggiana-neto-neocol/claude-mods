import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const TOOL = 'mcp__og-copy__og_copy'

const LAST = ['## Result', '', 'The guard asks only on writes.', '', '- First', '- Second', '', '| a | b |', '| - | - |'].join('\n')

/** One finished turn: the prompt, a tool call in between, and Claude's text around it. */
const MESSAGES = [
  { role: 'user', text: 'first question', toolUses: [] },
  { role: 'assistant', text: 'An older answer.', toolUses: [] },
  { role: 'user', text: 'fix the guard', toolUses: [] },
  { role: 'assistant', text: 'Let me look.', toolUses: [{ tool_use_id: 't1', tool: 'Bash' }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'ok', isError: false }] },
  { role: 'assistant', text: LAST, toolUses: [] },
]

/** The engine beneath the plugin: the transcript, the clipboard commands, toasts, the pane. */
const world = (on: On, init: { isPlaced?: boolean; messages?: unknown[]; clipboard?: string[]; os?: string } = {}) => {
  const copied: { argv: string[]; text: string }[] = []
  const toasts: string[] = []
  const closed: string[] = []
  const working = init.clipboard ?? ['pbcopy']

  mock.env(on, init.os === undefined ? {} : { OS: init.os })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__og-copy__${e.name}` } }))
  on('session.messages', () => ({ value: init.messages ?? MESSAGES }) as never)
  on('process.run', ($, e) => {
    const [cmd = ''] = e.argv
    if (!working.includes(cmd)) throw new Error(`ENOENT ${cmd}`)
    copied.push({ argv: [...e.argv], text: e.init?.stdin ?? '' })
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: init.isPlaced ?? true } }) as never)
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: undefined } as never
  })

  return { copied, toasts, closed }
}

const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }

const PANE = {
  plugin: 'og-copy',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'og-copy',
  props: {
    title: 'Copy',
    isFocused: true,
    bodyColumns: 100,
    placement: 'inline' as const,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
}

describe('panel', () => {
  test('lists the blocks of the last turn; checked blocks are copied as Markdown', async ($, on) => {
    const { copied, toasts, closed } = world(on)
    await $.command.run({ command: 'og-copy', ...RUN })
    const ui = await $.ui.mount(PANE)

    expect(await ui.find({ text: /Response 1 of 2/ })).toBeDefined()
    expect(await ui.find({ text: /Let me look\./ })).toBeDefined()
    expect(await ui.find({ text: /\| a \| b \|.*\(2 lines\)/ })).toBeDefined()

    await ui.press({ key: 'block:2' })
    await ui.press({ key: 'block:3' })
    await ui.press({ key: 'block:4' })
    await ui.press({ key: 'copy' })

    expect(copied).toEqual([{ argv: ['pbcopy'], text: 'The guard asks only on writes.\n\n- First\n- Second' }])
    expect(toasts[0]).toContain('Copied 3 of 6 blocks')
    expect(closed).toEqual(['og-copy'])
  })

  test('nothing checked copies all; check all, and an earlier response', async ($, on) => {
    const { copied } = world(on)
    await $.command.run({ command: 'og-copy', ...RUN })
    const ui = await $.ui.mount(PANE)

    await ui.press({ key: 'prev' })
    expect(await ui.find({ text: /Response 2 of 2/ })).toBeDefined()
    await ui.press({ key: 'copy' })
    expect(copied.at(-1)?.text).toBe('An older answer.')
    await ui.unmount()

    await $.command.run({ command: 'og-copy', ...RUN })
    const again = await $.ui.mount(PANE)
    await again.press({ key: 'block:0' })
    await again.press({ key: 'all' })
    await again.press({ key: 'copy' })
    expect(copied.at(-1)?.text).toBe(`Let me look.\n\n${LAST}`)
  })

  test('with no pane drawn, the whole last response is copied', async ($, on) => {
    const { copied } = world(on, { isPlaced: false })

    const { text } = await $.command.run({ command: 'og-copy', ...RUN })

    expect(text).toContain('Copied the last response')
    expect(copied[0]?.text).toBe(`Let me look.\n\n${LAST}`)
  })

  test('no response yet: nothing opens', async ($, on) => {
    world(on, { messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
    expect((await $.command.run({ command: 'og-copy', ...RUN })).text).toBe('No response to copy yet.')
  })
})

describe('clipboard', () => {
  test('falls back to wl-copy and xclip; says so when none works', async ($, on) => {
    const { copied, toasts } = world(on, { clipboard: ['xclip'] })
    await $.tool.call({ tool: TOOL, text: 'hello' } as never)
    expect(copied).toEqual([{ argv: ['xclip', '-selection', 'clipboard'], text: 'hello' }])
    expect(toasts).toEqual(['Copied 5 characters.'])
  })

  test('Windows uses Set-Clipboard', async ($, on) => {
    const { copied } = world(on, { os: 'Windows_NT', clipboard: ['powershell'] })
    await $.tool.call({ tool: TOOL, text: 'hello' } as never)
    expect(copied[0]?.argv[0]).toBe('powershell')
  })

  test('the tool refuses empty text and reports a clipboard that fails', async ($, on) => {
    world(on, { clipboard: [] })
    expect((await $.tool.call({ tool: TOOL, text: '  ' } as never)).deny).toContain('empty')
    expect((await $.tool.call({ tool: TOOL, text: 'x' } as never)).deny).toContain('no clipboard command worked')
  })
})
