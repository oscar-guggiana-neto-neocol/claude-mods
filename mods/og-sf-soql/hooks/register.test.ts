import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const RECORDS = {
  status: 0,
  result: {
    totalSize: 2,
    done: true,
    records: [
      { attributes: { type: 'Account' }, Id: '001A', Name: 'Acme', Owner: { attributes: { type: 'User' }, Name: 'Oscar' } },
      { attributes: { type: 'Account' }, Id: '001B', Name: 'Globex | Inc.', Owner: { attributes: { type: 'User' }, Name: 'Ana' } },
    ],
  },
}

const HUMAN = ' ID    NAME\n ───── ─────\n 001A  Acme\nTotal number of records retrieved: 2.'

/** The engine beneath the plugin: Bash, the sf CLI, the clipboard, toasts and the pane. */
const world = (on: On, init: { isPlaced?: boolean; sf?: (args: string[]) => { exitCode: number; stdout: string } } = {}) => {
  const sf: string[][] = []
  const copied: string[] = []
  const toasts: string[] = []
  const bash: string[] = []

  mock.env(on, {})
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', ($, e) => {
    const [cmd = '', ...args] = e.argv
    const out = (exitCode: number, stdout: string) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (cmd === 'pbcopy') {
      copied.push(e.init?.stdin ?? '')
      return out(0, '')
    }
    if (cmd === 'sf') {
      sf.push(args)
      const answer = init.sf?.(args) ?? { exitCode: 0, stdout: JSON.stringify(RECORDS) }
      return out(answer.exitCode, answer.stdout)
    }
    throw new Error(`ENOENT ${cmd}`)
  })
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    bash.push(e.command)
    const stdout = e.command.includes('--json') ? JSON.stringify(RECORDS) : e.command.includes('-r csv') ? 'Id,Name\n001A,Acme\n' : HUMAN
    return { result: { stdout, stderr: '', interrupted: false, isImage: false } }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: init.isPlaced ?? true } }) as never)
  on('ui.render', $ => ({ type: 'Text', props: {}, children: ['engine row'] }))

  return { sf, copied, toasts, bash }
}

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }

const PANE = {
  plugin: 'og-sf-soql',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'og-sf-soql',
  props: { title: 'SOQL', isFocused: true, bodyColumns: 100, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

const resultRow = (id: string) => ({
  plugin: 'og-sf-soql',
  surface: 'terminal' as const,
  component: 'ToolResult' as const,
  props: { tool_use_id: id, tool: 'Bash', output: { stdout: 'x' }, isErrored: false },
})

describe("Claude's queries", () => {
  test('a --json query: Claude gets the JSON, the pane the table, without running it again', async ($, on) => {
    const { sf } = world(on)
    const ran = await $.tool.call({ tool: 'Bash', command: `sf data query -q "SELECT Id, Name, Owner.Name FROM Account" -o qa --json` } as never)

    expect(JSON.stringify(ran.result)).toContain('001A')
    expect(sf).toEqual([])
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ text: /SELECT Id, Name, Owner.Name FROM Account/ })).toBeDefined()
    expect(await ui.find({ text: /qa · 2 records/ })).toBeDefined()
    expect(await ui.find({ text: /Id\s+Name\s+Owner\.Name/ })).toBeDefined()
    expect(await ui.find({ text: /001B\s+Globex \| Inc\.\s+Ana/ })).toBeDefined()
  })

  test('the human table: the same query runs again with --json for the pane', async ($, on) => {
    const { sf } = world(on)
    await $.tool.call({ tool: 'Bash', command: `sf data query -q "SELECT Id, Name FROM Account" -o qa` } as never)

    expect(sf).toEqual([['data', 'query', '--query', 'SELECT Id, Name FROM Account', '--target-org', 'qa', '--json']])
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ text: /Acme/ })).toBeDefined()
  })

  test('CSV is read as CSV; other commands are left alone', async ($, on) => {
    const { sf, bash } = world(on)
    await $.tool.call({ tool: 'Bash', command: `sf data query -q "SELECT Id, Name FROM Account" -r csv` } as never)
    await $.tool.call({ tool: 'Bash', command: 'git status' } as never)

    expect(sf).toEqual([])
    expect(bash).toHaveLength(2)
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ text: /1 record\b/ })).toBeDefined()
  })

  test('the transcript row of a captured query is one summary line', async ($, on) => {
    const ids: string[] = []
    // Before the world's Bash, which answers the call.
    on('tool.call', ($, e, next) => {
      ids.push(e.tool_use_id)
      return next(e)
    })
    world(on)
    await $.tool.call({ tool: 'Bash', command: `sf data query -q "SELECT Id, Name FROM Account" --json` } as never)
    await $.tool.call({ tool: 'Bash', command: 'git status' } as never)

    const query = await $.ui.mount(resultRow(ids[0] ?? ''))
    expect(await query.find({ text: '📋 2 records · Account · /og-soql to see' })).toBeDefined()
    const other = await $.ui.mount({ ...resultRow(ids[1] ?? ''), requestId: 'other' } as never)
    expect(await other.find({ text: 'engine row' })).toBeDefined()
  })
})

describe('/og-soql', () => {
  test('runs a query against an org, with the Tooling API', async ($, on) => {
    const { sf } = world(on)
    await $.command.run({ command: 'og-soql', args: '-o qa -t SELECT Id, Name FROM ApexClass', ...RUN })

    expect(sf[0]).toEqual(['data', 'query', '--query', 'SELECT Id, Name FROM ApexClass', '--target-org', 'qa', '--use-tooling-api', '--json'])
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ text: /Tooling API/ })).toBeDefined()
  })

  test("sf's error comes back as text; with no query yet it says so", async ($, on) => {
    world(on, { sf: () => ({ exitCode: 1, stdout: JSON.stringify({ status: 1, message: "MALFORMED_QUERY: unexpected token: 'FORM'" }) }) })

    expect((await $.command.run({ command: 'og-soql', args: '', ...RUN })).text).toContain('No query yet')
    expect((await $.command.run({ command: 'og-soql', args: 'SELECT Id FORM Account', ...RUN })).text).toBe(
      "Query failed: MALFORMED_QUERY: unexpected token: 'FORM'",
    )
  })

  test('with no pane drawn, it answers with the summary', async ($, on) => {
    world(on, { isPlaced: false })
    expect((await $.command.run({ command: 'og-soql', args: 'SELECT Id, Name FROM Account', ...RUN })).text).toBe(
      '📋 2 records · Account · /og-soql to see',
    )
  })
})

describe('pane', () => {
  test('copies the table as Markdown and CSV', async ($, on) => {
    const { copied, toasts } = world(on)
    await $.command.run({ command: 'og-soql', args: 'SELECT Id, Name, Owner.Name FROM Account', ...RUN })
    const ui = await $.ui.mount(PANE)

    await ui.press({ key: 'markdown' })
    expect(copied[0]).toBe('| Id | Name | Owner.Name |\n| --- | --- | --- |\n| 001A | Acme | Oscar |\n| 001B | Globex \\| Inc. | Ana |')
    await ui.press({ key: 'csv' })
    expect(copied[1]).toBe('Id,Name,Owner.Name\n001A,Acme,Oscar\n001B,Globex | Inc.,Ana')
    expect(toasts).toEqual(['Copied 2 rows as Markdown.', 'Copied 2 rows as CSV.'])
  })

  test('Enter shows a record; o opens it in the browser in its org; b goes back', async ($, on) => {
    const { sf } = world(on)
    await $.command.run({ command: 'og-soql', args: '-o qa SELECT Id, Name, Owner.Name FROM Account', ...RUN })
    const ui = await $.ui.mount(PANE)

    await ui.press({ key: 'row:1' })
    expect(await ui.find({ text: /Account 2 of 2/ })).toBeDefined()
    expect(await ui.find({ text: /Owner\.Name\s+Ana/ })).toBeDefined()

    await ui.press({ key: 'open' })
    expect(sf.at(-1)).toEqual(['org', 'open', '--path', '/001B', '--target-org', 'qa'])

    await ui.press({ key: 'back' })
    expect(await ui.find({ text: /Copy Markdown/ })).toBeDefined()
  })
})
