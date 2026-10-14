export type Brand = 'claude' | 'neocol' | 'lagana'
export type Mode = 'dark' | 'light'
export type Choice = { brand: Brand; mode: Mode }

const BRANDS: readonly Brand[] = ['claude', 'neocol', 'lagana']
const MODES: readonly Mode[] = ['dark', 'light']
const LABELS: Record<Brand, string> = { claude: 'Claude', neocol: 'Neocol', lagana: 'LaGana Lion' }

/** The menu, in the order its numbers name. */
export const OPTIONS: readonly Choice[] = BRANDS.flatMap(brand => MODES.map(mode => ({ brand, mode })))

export function label({ brand, mode }: Choice): string {
  return `${LABELS[brand]} ${mode}`
}

export function key({ brand, mode }: Choice): string {
  return `${brand}-${mode}`
}

export function fromKey(text: unknown): Choice | undefined {
  return OPTIONS.find(option => key(option) === text)
}

export type Args =
  | { kind: 'menu' }
  | { kind: 'reset' }
  | { kind: 'pick'; brand?: Brand; mode?: Mode }
  | { kind: 'unknown'; words: string[] }

/** `/og-theme 3`, `/og-theme neocol light` (any order, either word), `/og-theme reset`. */
export function parseArgs(args: string): Args {
  const words = args.toLowerCase().split(/\s+/).filter(word => word !== '')
  if (words.length === 0) return { kind: 'menu' }
  if (words.length === 1 && words[0] === 'reset') return { kind: 'reset' }
  if (words.length === 1 && /^\d+$/.test(words[0] ?? '')) {
    const option = OPTIONS[Number(words[0]) - 1]
    return option ? { kind: 'pick', ...option } : { kind: 'unknown', words }
  }
  const brand = BRANDS.find(b => words.includes(b))
  const mode = MODES.find(m => words.includes(m))
  const unknown = words.filter(word => word !== brand && word !== mode)

  return unknown.length > 0 ? { kind: 'unknown', words: unknown } : { kind: 'pick', brand, mode }
}

/** FNV-1a, so two folders with the same name get their own theme file. */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)

  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6)
}

export function baseName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(part => part !== '').pop() ?? 'root'
}

/** The project's own theme slug: a file in ~/.claude/themes the session watches. */
export function projectSlug(cwd: string): string {
  const name = baseName(cwd).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)

  // The `og-tema-` prefix predates the English command; kept so projects already set keep their file.
  return `og-tema-${name || 'root'}-${hash(cwd)}`
}

/** The project's theme file: Claude's own preset, or a brand's colors on its base. */
export function themeFile(choice: Choice, project: string, overrides: Record<string, string>): string {
  const theme = { name: `og-theme · ${project} (${label(choice)})`, base: choice.mode, overrides }

  return `${JSON.stringify(theme, null, 2)}\n`
}

/** The settings file with `theme` set, or removed when `value` is undefined; other keys kept. */
export function withTheme(text: string | undefined, value: string | undefined): string {
  const settings: Record<string, unknown> = text?.trim() ? JSON.parse(text) : {}
  if (value === undefined) delete settings.theme
  else settings.theme = value

  return `${JSON.stringify(settings, null, 2)}\n`
}

export function themeOf(text: string | undefined): unknown {
  return text?.trim() ? JSON.parse(text).theme : undefined
}
