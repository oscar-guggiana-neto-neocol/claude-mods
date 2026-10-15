import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

const PROJECT = '/work/globex-cpq'
const TOOL = 'mcp__og-ticket__og_ticket_set'

/** The world beneath the plugin: the working directory, git, the store, the status line. */
const world = (on: On, init: { cwd?: string; git?: boolean } = {}) => {
  const statuses: (string | undefined)[] = []
  const store = new Map<string, unknown>()
  const state = { cwd: init.cwd ?? `${PROJECT}/force-app`, git: init.git ?? true }

  const registered: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    registered.push(`/${e.name}`)
    return { value: { command: e.name } }
  })
  on('tool.register', ($, e) => {
    registered.push(e.name)
    return { value: { tool: `mcp__og-ticket__${e.name}` } }
  })
  on('session.cwd', () => ({ value: state.cwd }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    if (!state.git) throw new Error('ENOENT git')
    const root = state.cwd.startsWith(PROJECT) ? PROJECT : undefined
    return {
      value: {
        exitCode: root === undefined ? 128 : 0,
        stdout: root === undefined ? '' : `${root}\n`,
        stderr: root === undefined ? 'fatal: not a git repository' : '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  return { statuses, store, state, registered }
}

const start = ($: { session: { start: (e: never) => Promise<unknown> } }) =>
  $.session.start({ cwd: PROJECT, surface: 'terminal', isInteractive: true } as never)

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }

describe('og-ticket', () => {
  test('session start shows the focus stored for the project', async ($, on) => {
    const { statuses, store, registered } = world(on)
    store.set(`project:${PROJECT}`, { id: 'PLA-41', description: 'Fix the sync' })

    await start($)

    expect(statuses.at(-1)).toBe('🎫 PLA-41 · Fix the sync')
    expect(registered).toEqual(['/og-ticket', 'og_ticket_set'])
  })

  test('/og-ticket sets, shows and clears the focus', async ($, on) => {
    const { statuses, store } = world(on)
    await start($)
    expect(statuses.filter(Boolean)).toEqual([])

    const set = await $.command.run({ command: 'og-ticket', args: 'SFCOMPRG-1234 Quote sync fails', ...RUN })
    expect(statuses.at(-1)).toBe('🎫 SFCOMPRG-1234 · Quote sync fails')
    expect(store.get(`project:${PROJECT}`)).toEqual({ id: 'SFCOMPRG-1234', description: 'Quote sync fails' })
    expect(set.text).toContain('SFCOMPRG-1234')

    expect((await $.command.run({ command: 'og-ticket', args: '', ...RUN })).text).toContain('Quote sync fails')

    await $.command.run({ command: 'og-ticket', args: 'clear', ...RUN })
    expect(statuses.at(-1)).toBeUndefined()
    expect(store.has(`project:${PROJECT}`)).toBe(false)
    expect((await $.command.run({ command: 'og-ticket', args: '', ...RUN })).text).toContain('No focus')
  })

  test('Claude sets the focus with the tool; with nothing to set it is refused', async ($, on) => {
    const { statuses, store } = world(on)
    await start($)

    const set = await $.tool.call({ tool: TOOL, id: 'PLA-41', description: 'Fix the sync' } as never)
    expect(JSON.stringify(set.result)).toContain('PLA-41')
    expect(statuses.at(-1)).toBe('🎫 PLA-41 · Fix the sync')

    const refused = await $.tool.call({ tool: TOOL, description: '  ' } as never)
    expect(refused.deny).toContain('needs an id or a description')
    expect(store.get(`project:${PROJECT}`)).toEqual({ id: 'PLA-41', description: 'Fix the sync' })
  })

  test('outside git, or with no git at all, the directory is the project', async ($, on) => {
    const { statuses, store, state } = world(on, { cwd: '/notes' })
    await start($)

    await $.command.run({ command: 'og-ticket', args: 'Read the RFP', ...RUN })
    expect(store.get('project:/notes')).toEqual({ description: 'Read the RFP' })

    state.git = false
    await $.command.run({ command: 'og-ticket', args: 'Answer the RFP', ...RUN })
    expect(store.get('project:/notes')).toEqual({ description: 'Answer the RFP' })
    expect(statuses.at(-1)).toBe('🎫 Answer the RFP')
  })

  test('each project keeps its own focus', async ($, on) => {
    const { statuses, store, state } = world(on)
    store.set('project:/other', { description: 'Other work' })
    await start($)
    await $.command.run({ command: 'og-ticket', args: 'PLA-41 Here', ...RUN })

    state.cwd = '/other'
    await $.command.run({ command: 'og-ticket', args: '', ...RUN })

    expect(statuses.at(-1)).toBe('🎫 Other work')
    expect(store.get(`project:${PROJECT}`)).toEqual({ id: 'PLA-41', description: 'Here' })
  })
})
