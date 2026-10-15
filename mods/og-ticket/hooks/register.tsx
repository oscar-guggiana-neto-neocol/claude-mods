import type { EngineInterface, Register } from 'claude-code'

import type { Focus } from '../types'
import { focusOf, parseFocus, statusText } from './focus'

const PLUGIN = 'og-ticket'
const COMMAND = 'og-ticket'
const TOOL = 'og_ticket_set'

// The status text last shown, so an unchanged focus draws nothing.
let shown: string | undefined

const projectKey = (root: string) => `project:${root}`

/** The git root of the session's directory, or the directory itself outside git. */
async function projectOf($: EngineInterface) {
  const cwd = await $.session.cwd()
  const ran = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd }).catch(() => undefined)
  const root = ran?.exitCode === 0 ? ran.stdout.trim() : ''

  return root === '' ? cwd : root
}

async function load($: EngineInterface, root: string): Promise<Focus | undefined> {
  const stored = await $.store.get(projectKey(root))
  return stored !== null && typeof stored === 'object' ? (stored as Focus) : undefined
}

function show($: EngineInterface, focus: Focus | undefined) {
  const text = focus && statusText(focus)
  if (text === shown) return
  shown = text
  $.ui.status(text)
}

/** Stores the project's focus (undefined clears it) and draws it. */
async function save($: EngineInterface, root: string, focus: Focus | undefined) {
  if (focus === undefined) await $.store.delete(projectKey(root))
  else await $.store.set(projectKey(root), focus)
  show($, focus)
}

const explain = (focus: Focus | undefined) =>
  focus === undefined
    ? 'No focus. /og-ticket <ID> <description> sets one; the ID is optional.'
    : `Focus: ${[focus.id, focus.description].filter(Boolean).join(' · ')}`

export const register: Register = on => {
  shown = undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: COMMAND,
      description: 'The work item in focus (or /og-ticket <ID> <description>, /og-ticket clear)',
      argumentHint: '[ID] [description] | clear',
    })
    await $.tool.register({
      name: TOOL,
      description:
        "Sets the work item the user is on for this project, shown on the status line: an optional tracker ID (e.g. SFCOMPRG-1234) and a short description (one line). Use it when the user asks you to set the focus, for instance after reading a ticket or a document.",
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The tracker ID, if the item has one' },
          description: { type: 'string', description: 'What the item is about, in one short line' },
        },
      },
    })
    show($, await load($, await projectOf($)))

    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const root = await projectOf($)
    const text = e.args.trim()
    if (text === 'clear') {
      await save($, root, undefined)
      return { text: 'Focus cleared.' }
    }
    if (text === '') {
      const focus = await load($, root)
      show($, focus)
      return { text: explain(focus) }
    }
    const focus = parseFocus(text)
    await save($, root, focus)

    return { text: explain(focus) }
  }).catch(() => ({ text: `${PLUGIN}: could not read or save the focus.` }))

  on('tool.call', { tool: `mcp__${PLUGIN}__${TOOL}` }, async ($, e) => {
    const input = e as { id?: unknown; description?: unknown }
    const focus = focusOf(
      typeof input.id === 'string' ? input.id : undefined,
      typeof input.description === 'string' ? input.description : undefined,
    )
    if (focus === undefined) return { deny: 'The focus needs an id or a description.' }
    await save($, await projectOf($), focus)

    return { result: explain(focus) } as never
  })
}
