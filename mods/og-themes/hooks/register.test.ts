import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { parseArgs, parseValue, themeValue, withTheme } from './theme'

const PROJECT = '/work/app'
const SETTINGS = `${PROJECT}/.claude/settings.local.json`

describe('theme', () => {
  test('reads brand and mode in any order', () => {
    expect(parseArgs('Neocol light')).toEqual({ brand: 'neocol', mode: 'light', unknown: [] })
    expect(parseArgs('dark lagana')).toEqual({ brand: 'lagana', mode: 'dark', unknown: [] })
    expect(parseArgs('')).toEqual({ brand: undefined, mode: undefined, unknown: [] })
    expect(parseArgs('initech').unknown).toEqual(['initech'])
  })

  test('maps to the setting value and back', () => {
    expect(themeValue('claude', 'light')).toBe('light')
    expect(themeValue('lagana', 'dark')).toBe('custom:og-themes:lagana-dark')
    expect(parseValue('custom:og-themes:neocol-light')).toEqual({ brand: 'neocol', mode: 'light' })
    expect(parseValue('dark')).toEqual({ brand: 'claude', mode: 'dark' })
    expect(parseValue('custom:mine')).toBeUndefined()
  })

  test('keeps the other settings', () => {
    const text = JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, theme: 'dark' })
    expect(JSON.parse(withTheme(text, 'light'))).toEqual({ permissions: { allow: ['Bash(ls)'] }, theme: 'light' })
    expect(JSON.parse(withTheme(text, undefined))).toEqual({ permissions: { allow: ['Bash(ls)'] } })
    expect(JSON.parse(withTheme(undefined, 'dark'))).toEqual({ theme: 'dark' })
  })
})

const world = (on: On) => {
  const files: Record<string, string> = {}
  on('session.cwd', () => ({ value: PROJECT }))
  on('fs.exists', ($, e) => ({ value: e.path in files }))
  on('fs.read', ($, e) => ({ value: files[e.path] }))
  on('fs.write', ($, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })

  return files
}

const run = (args: string) => ({
  command: 'og-tema',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})

describe('plugin', () => {
  test('/og-tema writes the project theme and keeps the mode when only the brand changes', async ($, on) => {
    const files = world(on)

    expect((await $.command.run(run('neocol light'))).text).toBe('Tema deste projeto: Neocol light.')
    expect(JSON.parse(files[SETTINGS]).theme).toBe('custom:og-themes:neocol-light')

    expect((await $.command.run(run('lagana'))).text).toBe('Tema deste projeto: LaGana Lion light.')
    expect((await $.command.run(run('dark'))).text).toBe('Tema deste projeto: LaGana Lion dark.')
    expect(JSON.parse(files[SETTINGS]).theme).toBe('custom:og-themes:lagana-dark')

    expect((await $.command.run(run(''))).text).toMatch(/^Tema deste projeto: LaGana Lion dark\./)
  })

  test('/og-tema claude drops the override; an unknown word changes nothing', async ($, on) => {
    const files = world(on)
    files[SETTINGS] = JSON.stringify({ theme: 'custom:og-themes:neocol-dark', env: { A: '1' } })

    expect((await $.command.run(run('initech'))).text).toMatch(/^Não conheço "initech"/)
    expect((await $.command.run(run('claude'))).text).toMatch(/tema global/)
    expect(JSON.parse(files[SETTINGS])).toEqual({ env: { A: '1' } })
  })
})
