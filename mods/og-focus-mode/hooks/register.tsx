import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { compactLine } from './compact'

const COMMAND = 'og-focus'
const STORE_KEY = 'isOn'

const isOn = atom({ plugin: 'og-focus-mode', key: 'isOn' } as const, false)
const cwd = atom({ plugin: 'og-focus-mode', key: 'cwd' } as const, null)

async function toggle($: EngineInterface) {
  const next = !(await read($, isOn))
  if (next && (await read($, cwd)) === null) {
    const dir = await $.session.cwd()
    await update($, cwd, () => dir)
  }
  await update($, isOn, () => next)
  await $.store.set(STORE_KEY, next)

  return next
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: COMMAND, description: 'Turns focus mode on or off: a cleaner interface' })
    const [stored, dir] = await Promise.all([$.store.get(STORE_KEY), $.session.cwd()])
    await update($, isOn, () => stored === true)
    await update($, cwd, () => dir)

    return started
  })

  on('command.run', { command: COMMAND }, async $ => {
    const isNowOn = await toggle($)

    return { text: isNowOn ? 'Focus mode on.' : 'Focus mode off.' }
  }).catch(() => ({ text: 'og-focus-mode: could not toggle the mode.' }))

  // A tool call: one dim line; an error or an interruption keeps the full row.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { isErrored, isInterrupted, isRunning, tool, input, output } = e.props
    if (!(await read($, isOn)) || isErrored || isInterrupted) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const line = compactLine(tool, input, output, (await read($, cwd)) ?? undefined)

    return (
      <Box>
        <Text dimColor wrap="truncate-end">
          {isRunning ? '◦' : '·'} {line.label}
          {line.subject !== '' && ` ${line.subject}`}
          {line.counts !== undefined && <Text color="diffAdded">{` ${line.counts}`}</Text>}
        </Text>
      </Box>
    )
  })

  // The result under a call: drawn only when it failed.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await read($, isOn)) || e.props.isErrored) return next(e)
    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  // `Baked for 3s` and the notices under the logo.
  on('ui.render', { component: ['TurnDuration', 'InfoNotice'] }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  // `? for shortcuts` while idle; `esc to interrupt` stays while a turn runs.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!(await read($, isOn)) || e.props.isWorking) return next(e)

    // What other mods added at the end (`tail`) stays, as the line itself; a
    // rewritten hint would otherwise drop it.
    const tail = (e.props.tail ?? '').replace(/^\s*·\s*/, '')
    return next({ ...e, props: { ...e.props, hint: tail, tail: undefined } })
  })

  // The footer says when focus mode is on.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)

    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, 'og-focus'] } })
  })
}
