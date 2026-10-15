import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { QueryResult, View } from '../types'
import { GAP, cell, fitWidths, parseArgs, queriesIn, resultFromCsv, resultFromJson, toCsv, toMarkdown } from './soql'
import type { QueryCall } from './soql'

const COMMAND = 'og-soql'
const PANE = 'og-sf-soql'
// Rows drawn in the pane; the copies always carry them all.
const MAX_ROWS = 500

const view = atom({ plugin: 'og-sf-soql', key: 'view' } as const, null)

// The transcript's one-line summary for each query call Claude made, by tool_use_id.
const summaries = new Map<string, string>()

const SHELLS = new Set(['Bash', 'PowerShell'])

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const summaryOf = (result: QueryResult) =>
  `📋 ${plural(result.totalSize, 'record')}${result.object ? ` · ${result.object}` : ''} · /${COMMAND} to see`

/** Runs the sf CLI; on Windows through `cmd /c`, as `sf` is a batch file there. */
async function runSf($: EngineInterface, args: string[]) {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  return $.process.run(isWindows ? ['cmd.exe', '/d', '/s', '/c', 'sf', ...args] : ['sf', ...args], { timeoutMs: 120_000 })
}

const queryArgs = (source: { query?: string; file?: string; org?: string; isTooling: boolean }) => [
  'data',
  'query',
  ...(source.query !== undefined ? ['--query', source.query] : ['--file', source.file ?? '']),
  ...(source.org !== undefined ? ['--target-org', source.org] : []),
  ...(source.isTooling ? ['--use-tooling-api'] : []),
  '--json',
]

/** sf's own error message from its JSON, or the first line of what it printed. */
const errorOf = (stdout: string, stderr: string) => {
  try {
    const message = (JSON.parse(stdout) as { message?: unknown }).message
    if (typeof message === 'string') return message
  } catch {
    // Not JSON: what it printed.
  }
  return (stderr || stdout).trim().split('\n')[0] || 'the query failed'
}

/** The rows of a query Claude ran: from its own output, or, for the human table, a --json run of it. */
async function capture($: EngineInterface, call: QueryCall, stdout: string): Promise<QueryResult | undefined> {
  const text = call.query ?? (call.file !== undefined ? await $.fs.read(call.file).then(String, () => call.file) : undefined)
  const source = { query: (text ?? '').trim(), org: call.org, isTooling: call.isTooling }
  if (call.format === 'json') return resultFromJson(stdout, source)
  if (call.format === 'csv') return resultFromCsv(stdout, source)
  const ran = await runSf($, queryArgs(call)).catch(() => undefined)

  return ran === undefined ? undefined : resultFromJson(ran.stdout, source)
}

async function show($: EngineInterface, result: QueryResult) {
  await update($, view, () => ({ result, record: null }))
}

async function openPane($: EngineInterface) {
  const { isPlaced } = await $.ui.open({ id: PANE, title: 'SOQL', focus: true, closeOnEscape: true })
  return isPlaced
}

/** Puts text on the system clipboard: pbcopy, Set-Clipboard on Windows, wl-copy or xclip on Linux. */
async function toClipboard($: EngineInterface, text: string) {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const commands = isWindows
    ? [['powershell', '-NoProfile', '-Command', '[Console]::In.ReadToEnd() | Set-Clipboard']]
    : [['pbcopy'], ['wl-copy'], ['xclip', '-selection', 'clipboard']]
  for (const argv of commands) {
    const ran = await $.process.run(argv, { stdin: text }).catch(() => undefined)
    if (ran?.exitCode === 0) return
  }
  throw new Error('no clipboard command worked (pbcopy, wl-copy, xclip, Set-Clipboard)')
}

async function copyAs($: EngineInterface, result: QueryResult, as: 'Markdown' | 'CSV') {
  const text = as === 'Markdown' ? toMarkdown(result.columns, result.rows) : toCsv(result.columns, result.rows)
  await toClipboard($, text).then(
    () => $.ui.toast(`Copied ${plural(result.rows.length, 'row')} as ${as}.`),
    error => $.ui.toast(`og-sf-soql: ${error instanceof Error ? error.message : String(error)}`),
  )
}

async function openRecord($: EngineInterface, result: QueryResult, id: string) {
  const ran = await runSf($, ['org', 'open', '--path', `/${id}`, ...(result.org !== undefined ? ['--target-org', result.org] : [])]).catch(
    () => undefined,
  )
  $.ui.toast(ran?.exitCode === 0 ? `Opening ${id} in the browser.` : `og-sf-soql: could not open ${id}.`)
}

export const register: Register = on => {
  summaries.clear()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: COMMAND,
      description: 'The last SOQL result as a table (or /og-soql [-o org] [-t] SELECT … to run one)',
      argumentHint: '[-o org] [-t] [SELECT …]',
    })

    return started
  })

  // Claude's queries: the result goes to the pane, the transcript keeps one line.
  on('tool.call', async ($, e, next) => {
    const command = (e as { command?: unknown }).command
    const calls = SHELLS.has(e.tool) && typeof command === 'string' ? queriesIn(command) : []
    const call = calls.at(-1)
    if (call === undefined) return next(e)
    const ran = await next(e)
    const stdout = (ran.result as { stdout?: unknown } | undefined)?.stdout
    if (ran.deny !== undefined || ran.isError || typeof stdout !== 'string') return ran
    const result = await capture($, call, stdout).catch(() => undefined)
    if (result !== undefined) {
      await show($, result)
      summaries.set(e.tool_use_id, summaryOf(result))
    }

    return ran
    // A failure here never stops the query: before it ran, it runs; after, its result is replayed.
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const summary = summaries.get(e.props.tool_use_id)
    if (summary === undefined || e.props.isErrored) return next(e)
    const { Text } = $.ui.resolve(e)

    return <Text dimColor>{summary}</Text>
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const source = parseArgs(e.args)
    if (source.query === '') {
      const shown = await read($, view)
      if (shown === null) return { text: `No query yet. /${COMMAND} SELECT … runs one.` }
      await update($, view, one => (one === null ? one : { ...one, record: null }))
      return (await openPane($)) ? {} : { text: summaryOf(shown.result) }
    }
    const ran = await runSf($, queryArgs(source))
    const result = resultFromJson(ran.stdout, source)
    if (result === undefined) return { text: `Query failed: ${errorOf(ran.stdout, ran.stderr)}` }
    await show($, result)

    return (await openPane($)) ? {} : { text: summaryOf(result) }
  }).catch(($, e) => ({ text: `og-sf-soql: ${String(e)}` }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const shown: View | null = await read($, view)
    if (shown === null) return <Text dimColor>No query yet.</Text>
    const { result } = shown
    const width = Math.max(30, (e.props.bodyColumns ?? 100) - 4)
    const setRecord = (record: number | null) => update($, view, one => (one === null ? one : { ...one, record }))
    const row = shown.record === null ? undefined : result.rows[shown.record]

    if (row !== undefined) {
      const label = Math.min(30, Math.max(...result.columns.map(column => column.length)))
      const id = row.Id
      return (
        <Box flexDirection="column">
          <Text bold>
            {result.object ?? 'Record'} {shown.record === null ? '' : shown.record + 1} of {result.rows.length}
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {result.columns.map(column => (
              <Text key={`field:${column}`}>
                <Text dimColor>{column.padEnd(label)}</Text> {row[column] ?? ''}
              </Text>
            ))}
          </Box>
          <Box marginTop={1} gap={1}>
            <Button key="back" label="Back" hotkey="b" variant="primary" onPress={() => setRecord(null)} />
            {id !== undefined && id !== '' && <Button key="open" label="Open in browser" hotkey="o" onPress={() => openRecord($, result, id)} />}
          </Box>
        </Box>
      )
    }

    const widths = fitWidths(result.columns, result.rows, width)
    const gap = ' '.repeat(GAP)
    const line = (values: string[]) => values.map((value, i) => cell(value, widths[i] ?? 6)).join(gap)
    const drawn = result.rows.slice(0, MAX_ROWS)

    return (
      <Box flexDirection="column">
        <Text>{cell(result.query, width).trimEnd()}</Text>
        <Text dimColor>
          {[
            result.org,
            result.isTooling ? 'Tooling API' : undefined,
            plural(result.totalSize, 'record'),
            drawn.length < result.rows.length ? `showing ${drawn.length}` : undefined,
            'Tab moves · Enter opens a record',
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{line(result.columns)}</Text>
          {drawn.length === 0 && <Text dimColor>No records.</Text>}
          {drawn.map((one, i) => (
            <Button key={`row:${i}`} plain onPress={() => setRecord(i)}>
              {line(result.columns.map(column => one[column] ?? ''))}
            </Button>
          ))}
        </Box>
        <Box marginTop={1} gap={1}>
          <Button key="markdown" label="Copy Markdown" hotkey="m" variant="primary" onPress={() => copyAs($, result, 'Markdown')} />
          <Button key="csv" label="Copy CSV" hotkey="v" onPress={() => copyAs($, result, 'CSV')} />
        </Box>
      </Box>
    )
  })
}
