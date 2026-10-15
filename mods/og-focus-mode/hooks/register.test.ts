import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { compactLine } from './compact'

const CWD = '/work/app'

describe('compactLine', () => {
  test('says what each call is about in a few words', () => {
    expect(compactLine('Bash', { command: 'git status\ngit log' }, undefined)).toEqual({
      label: 'Bash',
      subject: 'git status',
      counts: undefined,
    })
    expect(compactLine('Read', { file_path: `${CWD}/src/org.ts` }, undefined, CWD).subject).toBe('src/org.ts')
    expect(compactLine('Grep', { pattern: 'TODO', path: `${CWD}/src` }, undefined, CWD).subject).toBe('TODO em src')
    expect(compactLine('WebFetch', { url: 'https://docs.example.com/a/b' }, undefined).subject).toBe('docs.example.com')
    expect(compactLine('mcp__jira__jira_get_issue', { key: 'X-1' }, undefined).label).toBe('jira · jira_get_issue')
    expect(compactLine('Agent', { description: 'Explore repo' }, undefined).subject).toBe('Explore repo')
  })

  test('counts an edit from its patch once done, from its input while running', () => {
    const output = { structuredPatch: [{ lines: [' a', '-b', '+c', '+d'] }, { lines: ['-e'] }] }
    expect(compactLine('Edit', { file_path: `${CWD}/x.ts` }, output, CWD)).toEqual({
      label: 'Edit',
      subject: 'x.ts',
      counts: '+2 −2',
    })
    expect(compactLine('Edit', { old_string: 'a', new_string: 'b\nc' }, undefined).counts).toBe('+2 −1')
    expect(compactLine('Write', { content: 'a\nb\nc' }, undefined).counts).toBe('+3 −0')
  })
})

/** The engine beneath the plugin: its store, and its own drawing of each site. */
const world = (on: On) => {
  const store = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: CWD }))
  on('ui.render', $ => ({ type: 'Text', props: {}, children: ['engine row'] }))

  return { store }
}

const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }

const toolUse = (props: Partial<{ tool: string; input: unknown; output: unknown; isErrored: boolean; isRunning: boolean }>) => ({
  plugin: 'og-focus-mode',
  surface: 'terminal' as const,
  component: 'ToolUse' as const,
  props: {
    tool_use_id: 'toolu_1',
    tool: 'Bash',
    input: { command: 'git status' },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    output: { stdout: 'clean', stderr: '' },
    ...props,
  },
})

describe('plugin', () => {
  test('off by default: every site draws as the engine does', async ($, on) => {
    world(on)

    const ui = await $.ui.mount(toolUse({}))

    expect(await ui.find({ text: 'engine row' })).toBeDefined()
  })

  test('/og-focus turns it on and off, and remembers it', async ($, on) => {
    const { store } = world(on)

    expect((await $.command.run({ command: 'og-focus', ...RUN })).text).toBe('Focus mode on.')
    expect(store.get('isOn')).toBe(true)

    const ui = await $.ui.mount(toolUse({}))
    expect(await ui.find({ text: /· Bash git status/ })).toBeDefined()
    expect(await ui.find({ text: 'engine row' })).toBeUndefined()

    expect((await $.command.run({ command: 'og-focus', ...RUN })).text).toBe('Focus mode off.')
    expect(store.get('isOn')).toBe(false)
    expect(await ui.find({ text: 'engine row' })).toBeDefined()
  })

  test('on: an edit shows its counts, an error keeps the full row', async ($, on) => {
    world(on)
    await $.command.run({ command: 'og-focus', ...RUN })

    const edit = await $.ui.mount(
      toolUse({
        tool: 'Edit',
        input: { file_path: `${CWD}/src/a.ts` },
        output: { structuredPatch: [{ lines: ['+x', '-y'] }] },
      }),
    )
    expect(await edit.find({ text: /Edit src\/a.ts/ })).toBeDefined()
    expect(await edit.find({ text: '+1 −1' })).toBeDefined()

    const failed = await $.ui.mount(toolUse({ isErrored: true, output: 'command not found' }))
    expect(await failed.find({ text: 'engine row' })).toBeDefined()
  })

  test('on: results, turn lines and notices are hidden; the footer says og-focus', async ($, on) => {
    world(on)
    await $.command.run({ command: 'og-focus', ...RUN })

    const result = await $.ui.mount({
      plugin: 'og-focus-mode',
      surface: 'terminal',
      component: 'ToolResult',
      props: { tool_use_id: 'toolu_1', tool: 'Bash', output: { stdout: 'x' }, isErrored: false },
    })
    expect(await result.drawn()).toMatchObject({ type: 'Box', props: { display: 'none' } })

    const turn = await $.ui.mount({
      plugin: 'og-focus-mode',
      surface: 'terminal',
      component: 'TurnDuration',
      props: { word: 'Baked', durationMs: 3000 },
    })
    expect(await turn.find({ text: 'engine row' })).toBeUndefined()

    const failedResult = await $.ui.mount({
      plugin: 'og-focus-mode',
      surface: 'terminal',
      component: 'ToolResult',
      props: { tool_use_id: 'toolu_2', tool: 'Bash', output: 'boom', isErrored: true },
    })
    expect(await failedResult.find({ text: 'engine row' })).toBeDefined()
  })

  test('on: the idle hint is emptied, but what other mods added at its end stays', async ($, on) => {
    const hints: { hint: string; tail?: string }[] = []
    // Before the world's own drawing, which answers every other site.
    on('ui.render', { component: 'PromptHint' }, ($, e) => {
      hints.push({ hint: e.props.hint, tail: e.props.tail })
      return { type: 'Text', props: {}, children: [e.props.hint] }
    })
    world(on)
    await $.command.run({ command: 'og-focus', ...RUN })
    const hint = (props: { hint: string; tail?: string; isWorking?: boolean }) =>
      $.ui.mount({
        plugin: 'og-focus-mode',
        surface: 'terminal',
        component: 'PromptHint',
        props: { isDraft: false, isWorking: false, ...props },
      })

    await hint({ hint: '? for shortcuts' })
    expect(hints.at(-1)).toEqual({ hint: '', tail: undefined })

    await hint({ hint: '? for shortcuts', tail: ' · 🎫 MOD-0001 · Create ticket mod' })
    expect(hints.at(-1)).toEqual({ hint: '🎫 MOD-0001 · Create ticket mod', tail: undefined })

    await hint({ hint: 'esc to interrupt', isWorking: true })
    expect(hints.at(-1)).toEqual({ hint: 'esc to interrupt', tail: undefined })
  })
})
