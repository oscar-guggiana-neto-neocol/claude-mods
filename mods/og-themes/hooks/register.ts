import type { EngineInterface, Register } from 'claude-code'

import { label, parseArgs, parseValue, themeValue, withTheme } from './theme'

const COMMAND = 'og-tema'
const USAGE = 'Uso: /og-tema [claude|neocol|lagana] [dark|light]. "/og-tema claude" volta ao tema global.'

/** The project's own settings file: personal, and above the user's settings. */
async function settingsPath($: EngineInterface) {
  return `${await $.session.cwd()}/.claude/settings.local.json`
}

async function readSettings($: EngineInterface, path: string) {
  return (await $.fs.exists(path)) ? $.fs.read(path) : undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: COMMAND,
      description: 'Tema do projeto: Claude, Neocol ou LaGana Lion, dark ou light',
      argumentHint: '[claude|neocol|lagana] [dark|light]',
    })

    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const { brand, mode, unknown } = parseArgs(e.args)
    if (unknown.length > 0) return { text: `Não conheço "${unknown.join(' ')}". ${USAGE}` }

    const path = await settingsPath($)
    const text = await readSettings($, path)
    const current = parseValue(text?.trim() ? JSON.parse(text).theme : undefined)

    if (brand === undefined && mode === undefined) {
      const now = current ? `Tema deste projeto: ${label(current.brand, current.mode)}.` : 'Este projeto usa o tema global.'
      return { text: `${now}\n${USAGE}` }
    }

    // Plain `/og-tema claude`: the project stops overriding the user's own choice.
    if (brand === 'claude' && mode === undefined) {
      await $.fs.write(path, withTheme(text, undefined))
      return { text: 'Tema do projeto removido: vale o tema global do Claude.' }
    }

    const nextBrand = brand ?? current?.brand ?? 'claude'
    const nextMode = mode ?? current?.mode ?? 'dark'
    await $.fs.write(path, withTheme(text, themeValue(nextBrand, nextMode)))

    return { text: `Tema deste projeto: ${label(nextBrand, nextMode)}.` }
  }).catch(() => ({ text: 'og-themes: não consegui ler ou gravar .claude/settings.local.json.' }))
}
