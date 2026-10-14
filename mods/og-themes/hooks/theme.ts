export type Brand = 'claude' | 'neocol' | 'lagana'
export type Mode = 'dark' | 'light'

const BRANDS: readonly Brand[] = ['claude', 'neocol', 'lagana']
const MODES: readonly Mode[] = ['dark', 'light']
const LABELS: Record<Brand, string> = { claude: 'Claude', neocol: 'Neocol', lagana: 'LaGana Lion' }
const PREFIX = 'custom:og-themes:'

/** `/og-tema neocol light`, in any order; either word may be left out. */
export function parseArgs(args: string): { brand?: Brand; mode?: Mode; unknown: string[] } {
  const words = args.toLowerCase().split(/\s+/).filter(word => word !== '')
  const brand = BRANDS.find(b => words.includes(b))
  const mode = MODES.find(m => words.includes(m))
  const unknown = words.filter(word => word !== brand && word !== mode)

  return { brand, mode, unknown }
}

/** The `theme` setting value: Claude's own presets, or this plugin's themes. */
export function themeValue(brand: Brand, mode: Mode): string {
  return brand === 'claude' ? mode : `${PREFIX}${brand}-${mode}`
}

/** Reads back what a `theme` value means, when it is one of ours or a plain preset. */
export function parseValue(value: unknown): { brand: Brand; mode: Mode } | undefined {
  if (value === 'dark' || value === 'light') return { brand: 'claude', mode: value }
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return undefined
  const [brand, mode] = value.slice(PREFIX.length).split('-')
  if (!BRANDS.includes(brand as Brand) || !MODES.includes(mode as Mode)) return undefined

  return { brand: brand as Brand, mode: mode as Mode }
}

export function label(brand: Brand, mode: Mode): string {
  return `${LABELS[brand]} ${mode}`
}

/** The settings file with `theme` set, or removed when `value` is undefined; other keys kept. */
export function withTheme(text: string | undefined, value: string | undefined): string {
  const settings: Record<string, unknown> = text?.trim() ? JSON.parse(text) : {}
  if (value === undefined) delete settings.theme
  else settings.theme = value

  return `${JSON.stringify(settings, null, 2)}\n`
}
