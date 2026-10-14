// Gradient bars that frame the panel, so what the mod draws stands apart
// from the rest of the terminal. Pure: each cell is a character and a color.

/** Color stops, by how guarded the target org is, in Neocol's palette: aqua to purple, yellow to salmon, salmon to red. */
export const PALETTES = {
  free: ['#00a6a5', '#3d7986', '#372554'],
  protected: ['#ffc907', '#fb7268'],
  production: ['#fb7268', '#e5383b', '#372554'],
} as const

export type Palette = keyof typeof PALETTES

export type Cell = { char: string; color: string; isBold?: boolean }

const rgbOf = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]

const hexOf = (rgb: number[]) => `#${rgb.map(part => Math.round(part).toString(16).padStart(2, '0')).join('')}`

/** `count` colors running evenly through the stops. */
export const gradient = (stops: readonly string[], count: number): string[] => {
  const rgbs = stops.map(rgbOf)
  if (count <= 1 || rgbs.length === 1) return Array.from({ length: count }, () => hexOf(rgbs[0] ?? [0, 0, 0]))

  return Array.from({ length: count }, (_, i) => {
    const at = (i / (count - 1)) * (rgbs.length - 1)
    const from = rgbs[Math.floor(at)] as number[]
    const to = rgbs[Math.min(Math.ceil(at), rgbs.length - 1)] as number[]
    const t = at - Math.floor(at)
    return hexOf(from.map((part, k) => part + ((to[k] as number) - part) * t))
  })
}

/** A line `width` wide: `━━ label ━━━…` with the label bold, all of it on the gradient. */
export const barCells = (width: number, palette: Palette, label?: string): Cell[] => {
  const text = label === undefined ? '' : ` ${label} `
  const lead = label === undefined ? 0 : 2
  const chars = [...'━'.repeat(lead), ...text, ...'━'.repeat(Math.max(0, width - lead - [...text].length))].slice(0, width)
  const colors = gradient(PALETTES[palette], chars.length)

  return chars.map((char, i) => ({
    char,
    color: colors[i] as string,
    isBold: i >= lead && i < lead + [...text].length,
  }))
}
