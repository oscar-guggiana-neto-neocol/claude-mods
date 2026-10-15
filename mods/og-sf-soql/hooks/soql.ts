// Pure logic: finding sf queries in a shell command, reading their records,
// and laying them out as a table. No `$` here, so tests drive it alone.

import type { QueryResult } from '../types'

/** A query found in a command: its text or file, the org and how sf prints it. */
export type QueryCall = {
  query?: string
  file?: string
  org?: string
  isTooling: boolean
  format: 'human' | 'json' | 'csv'
}

type Source = { query: string; org?: string; isTooling: boolean }

/** Splits a command line into simple commands of words, quotes removed. */
const commandsOf = (line: string): string[][] => {
  const commands: string[][] = []
  let words: string[] = []
  let word = ''
  let hasWord = false
  const endWord = () => {
    if (hasWord) words.push(word)
    word = ''
    hasWord = false
  }
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string
    if (c === "'" || c === '"') {
      const end = line.indexOf(c, i + 1)
      word += line.slice(i + 1, end < 0 ? line.length : end)
      hasWord = true
      i = end < 0 ? line.length : end
    } else if (c === '\\' && i + 1 < line.length) {
      word += line[++i]
      hasWord = true
    } else if (c === ' ' || c === '\t') {
      endWord()
    } else if (';&|\n()'.includes(c)) {
      endWord()
      if (words.length > 0) commands.push(words)
      words = []
    } else {
      word += c
      hasWord = true
    }
  }
  endWord()
  if (words.length > 0) commands.push(words)

  return commands
}

const flag = (args: string[], names: string[]): string | undefined => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    for (const name of names) {
      if (arg === name) return args[i + 1]
      if (name.startsWith('--') && arg.startsWith(`${name}=`)) return arg.slice(name.length + 1)
    }
  }

  return undefined
}

const program = (word: string) => (word.split(/[\\/]/).pop() ?? word).toLowerCase().replace(/\.(exe|cmd)$/, '')

/** Every `sf data query` (or `sfdx force:data:soql:query`) a command line runs. */
export const queriesIn = (line: string): QueryCall[] =>
  commandsOf(line).flatMap(words => {
    const start = words.findIndex(word => program(word) === 'sf' || program(word) === 'sfdx')
    if (start < 0) return []
    const args = words.slice(start + 1)
    const isQuery = (args[0] === 'data' && args[1] === 'query') || /^(force:)?data:soql:query$/.test(args[0] ?? '')
    if (!isQuery) return []
    const query = flag(args, ['--query', '-q'])
    const file = flag(args, ['--file', '-f'])
    const org = flag(args, ['--target-org', '-o', '--targetusername', '-u'])
    const resultFormat = flag(args, ['--result-format', '-r', '--resultformat'])
    const format = args.includes('--json') || resultFormat === 'json' ? 'json' : resultFormat === 'csv' ? 'csv' : 'human'
    if (query === undefined && file === undefined) return []
    const isTooling = args.includes('--use-tooling-api') || args.includes('-t') || args.includes('--usetoolingapi')
    const call: QueryCall = query !== undefined ? { query, isTooling, format } : { file, isTooling, format }
    if (org !== undefined) call.org = org

    return [call]
  })

/** `/og-soql` arguments: `-o <org>`, `-t`, then the query. */
export const parseArgs = (text: string): Source => {
  const words = text.trim().split(/\s+/).filter(Boolean)
  let org: string | undefined
  let isTooling = false
  while (words[0] === '-o' || words[0] === '-t') {
    if (words.shift() === '-o') org = words.shift()
    else isTooling = true
  }
  const source: Source = { query: words.join(' '), isTooling }
  if (org !== undefined) source.org = org

  return source
}

/** The object of the outer FROM, past any subquery. */
export const objectOf = (query: string) => {
  let depth = 0
  let outer = ''
  for (const c of query) {
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (depth === 0) outer += c
  }

  return /\bfrom\s+(\w+)/i.exec(outer)?.[1]
}

/** The SELECT list's field paths, a subquery named by its relationship. */
const selectFields = (query: string) => {
  const list = /^\s*select\s+([\s\S]*?)\s+from\s+\w+[^)]*$/i.exec(query.replace(/\([^()]*\)/g, sub => sub.replace(/,/g, ' ')))?.[1]
  if (list === undefined) return []

  return list
    .split(',')
    .map(field => field.trim())
    .map(field => (field.startsWith('(') ? (/\bfrom\s+(\w+)/i.exec(field)?.[1] ?? field) : field))
    .filter(Boolean)
}

type SfRecord = Record<string, unknown>

/** Records as flat rows: `Owner.Name` for a relationship, `[n]` for a subquery, '' for null. */
export const flatten = (records: SfRecord[]) => {
  const columns: string[] = []
  const add = (column: string) => {
    if (!columns.includes(column)) columns.push(column)
  }
  const rowOf = (record: SfRecord, prefix: string, row: Record<string, string>) => {
    for (const [key, value] of Object.entries(record)) {
      if (key === 'attributes') continue
      const path = `${prefix}${key}`
      if (value !== null && typeof value === 'object' && Array.isArray((value as { records?: unknown }).records)) {
        add(path)
        row[path] = `[${(value as { totalSize?: number; records: unknown[] }).totalSize ?? (value as { records: unknown[] }).records.length}]`
      } else if (value !== null && typeof value === 'object') {
        rowOf(value as SfRecord, `${path}.`, row)
      } else {
        add(path)
        row[path] = value === null || value === undefined ? '' : String(value)
      }
    }
    return row
  }
  const rows = records.map(record => rowOf(record, '', {}))

  // A relationship null in one record and filled in another is its fields' columns alone.
  return { columns: columns.filter(column => !columns.some(other => other.startsWith(`${column}.`))), rows }
}

const resultOf = (source: Source, columns: string[], rows: Record<string, string>[], totalSize: number): QueryResult => {
  const result: QueryResult = {
    query: source.query,
    isTooling: source.isTooling,
    columns: columns.length > 0 ? columns : selectFields(source.query),
    rows,
    totalSize,
  }
  const object = objectOf(source.query)
  if (object !== undefined) result.object = object
  if (source.org !== undefined) result.org = source.org

  return result
}

/** The result of `sf data query --json`; undefined for an error or anything else. */
export const resultFromJson = (stdout: string, source: Source): QueryResult | undefined => {
  let parsed: { status?: number; result?: { records?: unknown; totalSize?: number } }
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return undefined
  }
  const records = parsed.result?.records
  if (parsed.status !== 0 || !Array.isArray(records)) return undefined
  const { columns, rows } = flatten(records as SfRecord[])

  return resultOf(source, columns, rows, parsed.result?.totalSize ?? rows.length)
}

/** CSV (RFC 4180) as rows of fields. */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) rows.push([...row, field])

  return rows
}

/** The result of `sf data query -r csv`. */
export const resultFromCsv = (stdout: string, source: Source): QueryResult | undefined => {
  const [header, ...lines] = parseCsv(stdout.trim())
  if (header === undefined || header.length === 0) return undefined
  const rows = lines.map(line => Object.fromEntries(header.map((column, i) => [column, line[i] ?? ''])))

  return resultOf(source, header, rows, rows.length)
}

const csvField = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

export const toCsv = (columns: string[], rows: Record<string, string>[]) =>
  [columns, ...rows.map(row => columns.map(column => row[column] ?? ''))].map(fields => fields.map(csvField).join(',')).join('\n')

const mdCell = (value: string) => value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')

export const toMarkdown = (columns: string[], rows: Record<string, string>[]) =>
  [
    `| ${columns.map(mdCell).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${columns.map(column => mdCell(row[column] ?? '')).join(' | ')} |`),
  ].join('\n')

const MIN = 6
const MAX = 40
export const GAP = 2

/**
 * Column widths that fit `width` with GAP spaces between columns: each its
 * longest value (40 at most); when too wide, the widest shrink first, to 6.
 */
export const fitWidths = (columns: string[], rows: Record<string, string>[], width: number) => {
  const widths = columns.map(column =>
    Math.min(MAX, Math.max(column.length, ...rows.map(row => [...(row[column] ?? '')].length))),
  )
  const room = width - GAP * (columns.length - 1)
  while (widths.reduce((a, b) => a + b, 0) > room) {
    const widest = widths.indexOf(Math.max(...widths))
    if ((widths[widest] ?? 0) <= MIN) break
    widths[widest] = (widths[widest] ?? MIN) - 1
  }

  return widths
}

/** A value padded or cut to a width. */
export const cell = (value: string, width: number) => {
  const chars = [...value.replace(/\s+/g, ' ')]
  return chars.length <= width ? chars.join('').padEnd(width) : `${chars.slice(0, width - 1).join('')}…`
}
