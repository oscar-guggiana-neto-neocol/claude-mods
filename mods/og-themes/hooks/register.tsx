import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { baseName, fromKey, key, label, OPTIONS, parseArgs, projectSlug, themeFile, themeOf, withTheme } from './theme'
import type { Choice } from './theme'

const COMMAND = 'og-theme'
const PANE = 'og-theme'
const USAGE = 'Usage: /og-theme (menu), /og-theme <1-6>, /og-theme [claude|neocol|lagana] [dark|light], /og-theme reset.'

const choice = atom({ plugin: 'og-themes', key: 'choice' } as const, null)
const note = atom({ plugin: 'og-themes', key: 'note' } as const, null)

type Project = { cwd: string; name: string; slug: string; settings: string; themeFile: string }

async function project($: EngineInterface): Promise<Project> {
  const [cwd, configDir, home, profile] = await Promise.all([
    $.session.cwd(),
    $.env.get('CLAUDE_CONFIG_DIR'),
    $.env.get('HOME'),
    $.env.get('USERPROFILE'),
  ])
  const slug = projectSlug(cwd)
  // HOME is often unset on Windows; USERPROFILE is its home there.
  const claudeDir = configDir ?? `${home ?? profile}/.claude`

  return {
    cwd,
    name: baseName(cwd),
    slug,
    settings: `${cwd}/.claude/settings.local.json`,
    themeFile: `${claudeDir}/themes/${slug}.json`,
  }
}

async function readText($: EngineInterface, path: string) {
  return (await $.fs.exists(path)) ? $.fs.read(path) : undefined
}

/** The colors the plugin ships for a brand; Claude's own theme overrides nothing. */
async function overridesOf($: EngineInterface, picked: Choice): Promise<Record<string, string>> {
  if (picked.brand === 'claude') return {}
  const text = await $.fs.read(`${$.plugin.root}/themes/${key(picked)}.json`)

  return JSON.parse(text).overrides ?? {}
}

/** Whether this session draws the project's theme file, so rewriting it shows at once. */
async function isLive($: EngineInterface, slug: string) {
  const row = (await $.config.list()).find(one => one.key === 'theme')

  return row?.value === `custom:${slug}`
}

/**
 * Writes the project's theme file and points the project's settings at it.
 * The session reloads ~/.claude/themes on change, so once it runs on that
 * file every later pick shows at once; the first one waits for a new session.
 */
async function apply($: EngineInterface, picked: Choice): Promise<string> {
  const p = await project($)
  await $.fs.write(p.themeFile, themeFile(picked, p.name, await overridesOf($, picked)))
  const settings = await readText($, p.settings)
  if (themeOf(settings) !== `custom:${p.slug}`) await $.fs.write(p.settings, withTheme(settings, `custom:${p.slug}`))
  await $.store.set(`choice:${p.slug}`, key(picked))
  await update($, choice, () => key(picked))

  const text = (await isLive($, p.slug))
    ? `This project's theme: ${label(picked)}.`
    : `This project's theme: ${label(picked)}. It takes effect from the next session in this project; after that, changes show at once.`
  await update($, note, () => text)

  return text
}

async function reset($: EngineInterface): Promise<string> {
  const p = await project($)
  const settings = await readText($, p.settings)
  if (themeOf(settings) === `custom:${p.slug}`) await $.fs.write(p.settings, withTheme(settings, undefined))
  await $.store.set(`choice:${p.slug}`, null)
  await update($, choice, () => null)

  return 'Project theme removed: the next session uses the global theme.'
}

async function openMenu($: EngineInterface) {
  await update($, note, () => null)
  await $.ui.open({ id: PANE, title: 'Theme', focus: true, closeOnEscape: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: COMMAND,
      description: 'Project theme: Claude, Neocol or LaGana Lion, dark or light',
      argumentHint: '[1-6 | claude|neocol|lagana dark|light | reset]',
    })
    const p = await project($)
    const stored = fromKey(await $.store.get(`choice:${p.slug}`))
    await update($, choice, () => (stored ? key(stored) : null))
    // Rewrite the file from the shipped colors, so an update of the plugin reaches it.
    if (stored && themeOf(await readText($, p.settings)) === `custom:${p.slug}`) {
      await $.fs.write(p.themeFile, themeFile(stored, p.name, await overridesOf($, stored)))
    }

    return started
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const args = parseArgs(e.args)
    if (args.kind === 'menu') {
      await openMenu($)
      const now = fromKey(await read($, choice))
      return { text: now ? `This project's theme: ${label(now)}.` : 'This project uses the global theme.' }
    }
    if (args.kind === 'reset') return { text: await reset($) }
    if (args.kind === 'unknown') return { text: `Unknown option "${args.words.join(' ')}". ${USAGE}` }

    const now = fromKey(await read($, choice))
    const picked: Choice = { brand: args.brand ?? now?.brand ?? 'claude', mode: args.mode ?? now?.mode ?? 'dark' }

    return { text: await apply($, picked) }
  }).catch(() => ({ text: 'og-themes: could not save the project theme.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [current, shownNote] = await Promise.all([read($, choice), read($, note)])

    return (
      <Box flexDirection="column">
        <Text bold>This project's theme: press a number</Text>
        <Box flexDirection="column" marginTop={1}>
          {OPTIONS.map((option, i) => (
            <Button
              key={`pick:${key(option)}`}
              label={`${i + 1}. ${label(option)}${current === key(option) ? '  ●' : ''}`}
              hotkey={String(i + 1)}
              variant={current === key(option) ? 'primary' : undefined}
              onPress={() => apply($, option)}
            />
          ))}
        </Box>
        <Box marginTop={1}>
          {shownNote !== null ? <Text dimColor>{shownNote}</Text> : <Text dimColor>Esc closes.</Text>}
        </Box>
      </Box>
    )
  })
}
