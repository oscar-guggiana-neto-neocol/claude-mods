import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { OPTIONS, parseArgs, projectSlug, themeFile, withTheme } from './theme'

const HOME = '/home/u'
const PROJECT = '/work/app'
const SETTINGS = `${PROJECT}/.claude/settings.local.json`
const SLUG = projectSlug(PROJECT)
const THEME_FILE = `${HOME}/.claude/themes/${SLUG}.json`

describe('theme', () => {
  test('reads a number, brand and mode in any order, or reset', () => {
    expect(parseArgs('')).toEqual({ kind: 'menu' })
    expect(parseArgs('3')).toEqual({ kind: 'pick', brand: 'neocol', mode: 'dark' })
    expect(parseArgs('Light lagana')).toEqual({ kind: 'pick', brand: 'lagana', mode: 'light' })
    expect(parseArgs('dark')).toEqual({ kind: 'pick', brand: undefined, mode: 'dark' })
    expect(parseArgs('reset')).toEqual({ kind: 'reset' })
    expect(parseArgs('9')).toEqual({ kind: 'unknown', words: ['9'] })
    expect(parseArgs('initech')).toEqual({ kind: 'unknown', words: ['initech'] })
  })

  test('numbers the six options, and gives each folder its own slug', () => {
    expect(OPTIONS.map(o => `${o.brand}-${o.mode}`)).toEqual([
      'claude-dark',
      'claude-light',
      'neocol-dark',
      'neocol-light',
      'lagana-dark',
      'lagana-light',
    ])
    expect(projectSlug('/a/My App')).toMatch(/^og-tema-my-app-[0-9a-f]{6}$/)
    expect(projectSlug('/a/app')).not.toBe(projectSlug('/b/app'))
  })

  test('writes the theme file on the mode base; keeps the other settings', () => {
    expect(JSON.parse(themeFile({ brand: 'neocol', mode: 'light' }, 'app', { claude: '#3d7986' }))).toEqual({
      name: 'og-tema · app (Neocol light)',
      base: 'light',
      overrides: { claude: '#3d7986' },
    })
    const text = JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, theme: 'dark' })
    expect(JSON.parse(withTheme(text, undefined))).toEqual({ permissions: { allow: ['Bash(ls)'] } })
  })
})

const world = (on: On, liveTheme: string) => {
  const files: Record<string, string> = {}
  const store = new Map<string, unknown>()
  mock.env(on, { HOME })
  on('session.cwd', () => ({ value: PROJECT }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: e.path in files }))
  on('fs.read', ($, e) => {
    const shipped = /\/themes\/(neocol|lagana)-(dark|light)\.json$/.exec(e.path)
    if (shipped) return { value: JSON.stringify({ overrides: { claude: `${shipped[1]}-${shipped[2]}` } }) }
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', ($, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('config.list', () => ({
    value: [
      {
        key: 'theme',
        label: 'Theme',
        kind: 'choice' as const,
        value: liveTheme,
        provider: { plugin: 'engine', tier: 'core' as const },
        isLocked: false,
      },
    ],
  }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))

  return files
}

const run = (args: string) => ({
  command: 'og-tema',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})

const PANE_PROPS = {
  title: 'Tema',
  isFocused: true,
  bodyColumns: 100,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

const parsed = (text: string | undefined) => JSON.parse(text ?? '{}')

describe('plugin', () => {
  test('the first pick writes the theme file and points the project at it', async ($, on) => {
    const files = world(on, 'dark')

    expect((await $.command.run(run('4'))).text).toMatch(/^Tema deste projeto: Neocol light\. Vale a partir da próxima sessão/)
    expect(parsed(files[SETTINGS]).theme).toBe(`custom:${SLUG}`)
    expect(parsed(files[THEME_FILE])).toMatchObject({ base: 'light', overrides: { claude: 'neocol-light' } })
  })

  test('once the session draws the file, picks change it in place', async ($, on) => {
    const files = world(on, `custom:${SLUG}`)

    expect((await $.command.run(run('lagana dark'))).text).toBe('Tema deste projeto: LaGana Lion dark.')
    expect((await $.command.run(run('light'))).text).toBe('Tema deste projeto: LaGana Lion light.')
    expect((await $.command.run(run('claude'))).text).toBe('Tema deste projeto: Claude light.')
    expect(parsed(files[THEME_FILE])).toMatchObject({ base: 'light', overrides: {} })
  })

  test('the menu numbers the options and a number key picks one', async ($, on) => {
    const files = world(on, `custom:${SLUG}`)
    await $.command.run(run(''))

    const ui = await $.ui.mount({ plugin: 'og-themes', surface: 'terminal', component: 'Pane', requestId: 'og-tema', props: PANE_PROPS })
    expect(await ui.find({ text: /1\. Claude dark/ })).toBeDefined()
    expect(await ui.find({ text: /6\. LaGana Lion light/ })).toBeDefined()

    await ui.press({ key: 'pick:neocol-dark' })
    expect(parsed(files[THEME_FILE])).toMatchObject({ base: 'dark', overrides: { claude: 'neocol-dark' } })
    expect(await ui.find({ text: /3\. Neocol dark  ●/ })).toBeDefined()
  })

  test('reset drops the project setting; an unknown word changes nothing', async ($, on) => {
    const files = world(on, `custom:${SLUG}`)
    files[SETTINGS] = JSON.stringify({ theme: `custom:${SLUG}`, env: { A: '1' } })

    expect((await $.command.run(run('initech'))).text).toMatch(/^Não conheço "initech"/)
    expect((await $.command.run(run('reset'))).text).toMatch(/tema global/)
    expect(parsed(files[SETTINGS])).toEqual({ env: { A: '1' } })
  })
})
