import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { baseName, buildCatalog, classify, domainOf, findProjectRoot, inferProjectOrgs, parentOf, parseInfo, resolveTargetOrg, statusText } from './org'

const HOME = '/home/u'
const PROJECT = '/work/globex-cpq'

const AUTH = {
  prod: { instanceUrl: 'https://acme.my.salesforce.com', loginUrl: 'https://login.salesforce.com' },
  uat: { instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com', isSandbox: true },
  scratch: { instanceUrl: 'https://fun-96-dev-ed.scratch.my.salesforce.com', isScratch: true },
  devEd: { instanceUrl: 'https://orgfarm-1-dev-ed.develop.my.salesforce.com' },
}

// Two Globex sandboxes, one unrelated production org, one generic scratch org.
const ORGS: Record<string, object> = {
  'me@globex.com.globexdev': { ...AUTH.uat, instanceUrl: 'https://globex--globexdev.sandbox.my.salesforce.com' },
  'me@globex.com.globexqa': { ...AUTH.uat, instanceUrl: 'https://globex--globexqa.sandbox.my.salesforce.com' },
  'me@acme.com': AUTH.prod,
  'test-x@example.com': AUTH.scratch,
}

const baseFiles = (): Record<string, string> => {
  const files: Record<string, string> = {
    [`${PROJECT}/sfdx-project.json`]: JSON.stringify({ name: 'globex-cpq' }),
    [`${HOME}/.sfdx/alias.json`]: JSON.stringify({
      orgs: { globexdev: 'me@globex.com.globexdev', globexqa: 'me@globex.com.globexqa', acme: 'me@acme.com' },
    }),
  }
  for (const [username, auth] of Object.entries(ORGS)) {
    files[`${HOME}/.sfdx/${username}.json`] = JSON.stringify({ username, ...auth })
  }
  return files
}

const readerOf = (files: Record<string, string>) => async (path: string) => files[path]

/** The world beneath the plugin: files, the sf CLI, the status line, panes. */
const world = (on: On, files: Record<string, string>, env: Record<string, string> = { HOME }, cwd = PROJECT, isPlaced = true) => {
  const statuses: (string | undefined)[] = []
  const commands: string[][] = []
  const store = new Map<string, unknown>()

  mock.env(on, env)
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: cwd }))
  on('fs.read', ($, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.list', ($, e) => ({
    value: Object.keys(files)
      .filter(path => path.startsWith(`${e.path}/`) && !path.slice(e.path.length + 1).includes('/'))
      .map(path => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('process.run', ($, e) => {
    commands.push([...e.argv])
    const argv = e.argv[0] === 'cmd.exe' ? e.argv.slice(4) : e.argv
    const [, noun, verb] = argv
    if (noun === 'config' && verb === 'set') {
      const target = argv[3]?.replace('target-org=', '')
      files[`${e.cwd ?? cwd}/.sf/config.json`] = JSON.stringify({ 'target-org': target })
    }
    const stdout =
      noun === 'org' && verb === 'display'
        ? JSON.stringify({ status: 0, result: { id: '00D1', apiVersion: '68.0', connectedStatus: 'Connected' } })
        : noun === 'data'
          ? JSON.stringify({ result: { records: [{ OrganizationType: 'Enterprise Edition', InstanceName: 'NA1' }] } })
          : JSON.stringify({ status: 0 })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced } }) as never)

  // What another mod draws in the band, beneath this one.
  on('ui.render', { component: 'AbovePrompt' }, $ => ({ type: 'Text', props: {}, children: ['another mod'] }))

  return { statuses, commands, store }
}

const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }

const PANE = {
  plugin: 'og-sf-org-status',
  component: 'Pane' as const,
  requestId: 'sf-orgs',
  props: {
    title: 'Salesforce orgs',
    isFocused: true,
    bodyColumns: 100,
    placement: 'inline' as const,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
}

describe('classify', () => {
  test('tells the org kinds apart from the auth file', () => {
    expect(classify(AUTH.prod)).toBe('production')
    expect(classify(AUTH.uat)).toBe('sandbox')
    expect(classify({ instanceUrl: AUTH.uat.instanceUrl })).toBe('sandbox')
    expect(classify({ loginUrl: 'https://test.salesforce.com/' })).toBe('sandbox')
    expect(classify(AUTH.scratch)).toBe('scratch')
    expect(classify(AUTH.devEd)).toBe('developer')
    expect(classify(undefined)).toBe('unknown')
  })
})

describe('Windows', () => {
  test('walks Windows paths up to the drive root', async () => {
    expect(parentOf('C:\\work\\app\\force-app')).toBe('C:\\work\\app')
    expect(parentOf('C:\\work')).toBe('C:\\')
    expect(parentOf('C:\\')).toBe('C:\\')
    expect(parentOf('/work/app/')).toBe('/work')
    expect(parentOf('/work')).toBe('/')
    expect(baseName('C:\\work\\globex-cpq\\')).toBe('globex-cpq')
    const read = readerOf({ 'C:\\work\\app/sfdx-project.json': '{}' })
    expect(await findProjectRoot(read, 'C:\\work\\app\\force-app\\main')).toBe('C:\\work\\app')
    expect(await findProjectRoot(read, 'D:\\other\\dir')).toBeUndefined()
  })

  test('reads orgs under USERPROFILE and runs sf through cmd', async ($, on) => {
    // The test engine resolves POSIX paths; Windows paths are walked above.
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'globexqa' })
    const { statuses, commands } = world(on, files, { USERPROFILE: HOME, OS: 'Windows_NT' })

    await $.command.run({ command: 'og-sf-org', ...RUN })
    expect(statuses[0]).toContain('globexqa')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'row:me@globex.com.globexdev' })
    await ui.press({ key: 'target' })
    expect(commands).toContainEqual(['cmd.exe', '/d', '/s', '/c', 'sf', 'config', 'set', 'target-org=globexdev', '--json'])
    expect(statuses.at(-1)).toContain('globexdev')
  })
})

describe('resolveTargetOrg', () => {
  test('project config wins over global, alias resolved', async () => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'globexqa' })
    files[`${HOME}/.sf/config.json`] = JSON.stringify({ 'target-org': 'acme' })

    const org = await resolveTargetOrg(readerOf(files), { cwd: `${PROJECT}/force-app/main`, home: HOME })

    expect(org).toEqual(
      expect.objectContaining({ alias: 'globexqa', username: 'me@globex.com.globexqa', kind: 'sandbox', source: 'project' }),
    )
  })

  test('falls back to the global config, then env overrides both', async () => {
    const files = baseFiles()
    files[`${HOME}/.sf/config.json`] = JSON.stringify({ 'target-org': 'acme' })

    const global = await resolveTargetOrg(readerOf(files), { cwd: PROJECT, home: HOME })
    expect(global?.kind).toBe('production')
    expect(global?.source).toBe('global')

    const env = await resolveTargetOrg(readerOf(files), { cwd: PROJECT, home: HOME, envTarget: 'globexqa' })
    expect(env?.source).toBe('env')
    expect(env?.kind).toBe('sandbox')
  })

  test('reads the legacy sfdx-config.json and a bare username', async () => {
    const files = baseFiles()
    files[`${PROJECT}/.sfdx/sfdx-config.json`] = JSON.stringify({ defaultusername: 'me@acme.com' })

    const org = await resolveTargetOrg(readerOf(files), { cwd: PROJECT, home: HOME })

    expect(org).toEqual(expect.objectContaining({ alias: undefined, username: 'me@acme.com', kind: 'production' }))
    expect(statusText(org!)).toBe('SF 🔴 PROD · me@acme.com')
  })

  test('nothing outside a DX project, and unknown when not authenticated', async () => {
    const files = baseFiles()
    files[`${HOME}/.sf/config.json`] = JSON.stringify({ 'target-org': 'ghost' })

    expect(await resolveTargetOrg(readerOf(files), { cwd: '/elsewhere', home: HOME })).toBeUndefined()
    expect((await resolveTargetOrg(readerOf(files), { cwd: PROJECT, home: HOME }))?.kind).toBe('unknown')
  })
})

describe('project orgs', () => {
  test('domainOf reads the company out of a username', () => {
    expect(domainOf('me@globex.com.globexqa')).toBe('globex.com')
    expect(domainOf('jdoe@initech.com.neworg.qa2')).toBe('initech.com')
    expect(domainOf('me@cliente.com.br.uat')).toBe('cliente.com.br')
    expect(domainOf('test-x@example.com')).toBeUndefined()
    expect(domainOf('oscar@neocol.rca.demo')).toBeUndefined()
  })

  test('infers the current org and its domain mates', () => {
    const catalog = buildCatalog(
      Object.entries(ORGS).map(([username, auth]) => ({ username, ...auth })),
      { globexdev: 'me@globex.com.globexdev', globexqa: 'me@globex.com.globexqa', DEFAULT_TARGET_ORG: 'me@acme.com' },
    )
    const current = { target: 'globexqa', alias: 'globexqa', username: 'me@globex.com.globexqa', kind: 'sandbox' as const, source: 'project' as const }

    expect(inferProjectOrgs(catalog, current).map(row => row.alias)).toEqual(['globexdev', 'globexqa'])
    expect(catalog.find(row => row.username === 'me@acme.com')?.alias).toBeUndefined()
  })

  test('parseInfo keeps the fields shown and reports a failure', () => {
    const display = JSON.stringify({ result: { id: '00D1', apiVersion: '68.0', connectedStatus: 'Connected' } })
    const query = JSON.stringify({ result: { records: [{ OrganizationType: 'Developer Edition', TrialExpirationDate: '2026-11-01T00:00:00.000+0000' }] } })

    expect(parseInfo(display, query)).toEqual({
      status: 'ok',
      orgId: '00D1',
      apiVersion: '68.0',
      connectedStatus: 'Connected',
      edition: 'Developer Edition',
      pod: undefined,
      expires: '2026-11-01',
    })
    expect(parseInfo(JSON.stringify({ status: 1, message: 'No authorization' }), undefined)).toEqual({
      status: 'error',
      message: 'No authorization',
    })
  })
})

describe('plugin', () => {
  test('/og-sf-org sets the status line and shows the target in the panel, not the transcript', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'acme' })
    const { statuses } = world(on, files)

    const { text } = await $.command.run({ command: 'og-sf-org', ...RUN })

    expect(statuses).toEqual(['SF 🔴 PROD · acme'])
    expect(text).toBeUndefined()
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ text: /Target: acme 🔴 PROD/ })).toBeDefined()
    expect(await ui.find({ text: /og-sf-org-status/ })).toBeDefined()
    expect(await ui.find({ text: /from the project's \.sf\/config\.json/ })).toBeDefined()
    expect(await ui.find({ text: /me@acme\.com · https:\/\/acme\.my\.salesforce\.com/ })).toBeDefined()
  })

  test('with no panel drawn, /og-sf-org explains the target as text', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'acme' })
    world(on, files, { HOME }, PROJECT, false)

    const { text } = await $.command.run({ command: 'og-sf-org', ...RUN })

    expect(text).toContain('Target org: acme (production)')
    expect(text).toContain("the project's .sf/config.json")
  })

  test('the pane lists the inferred orgs and switches the target', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'globexdev' })
    const { statuses, commands } = world(on, files)

    await $.command.run({ command: 'og-sf-org', ...RUN })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ text: /list inferred/ })).toBeDefined()
      expect(await ui.find({ key: 'row:me@globex.com.globexqa' })).toBeDefined()
      expect(await ui.find({ key: 'row:me@acme.com' })).toBeUndefined()
      expect(await ui.find({ text: /Enterprise Edition · API 68.0 · pod NA1/ })).toBeDefined()
      await ui.unmount()
    }

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'row:me@globex.com.globexqa' })
    await ui.press({ key: 'target' })

    expect(commands).toContainEqual(['sf', 'config', 'set', 'target-org=globexqa', '--json'])
    expect(statuses.at(-1)).toBe('SF 🟡🔒 sandbox · globexqa')
    expect(await ui.find({ text: /Target org now: globexqa/ })).toBeDefined()
  })

  test('editing the list saves it for the project', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'globexdev' })
    const { store } = world(on, files)

    await $.command.run({ command: 'og-sf-org', ...RUN })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'edit' })
    expect(await ui.find({ text: /Enter checks\/unchecks/ })).toBeDefined()
    await ui.press({ key: 'check:me@globex.com.globexqa' })
    await ui.press({ key: 'save' })

    expect(store.get(`project:${PROJECT}`)).toEqual(['me@globex.com.globexdev'])
    expect(await ui.find({ text: /saved list/ })).toBeDefined()
    expect(await ui.find({ key: 'row:me@globex.com.globexqa' })).toBeUndefined()
  })

  test('/og-sf-org <alias> switches without the pane', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'globexdev' })
    const { commands } = world(on, files)

    const { text } = await $.command.run({ command: 'og-sf-org', ...RUN, args: 'globexqa' })

    expect(text).toBe('Target org now: globexqa')
    expect(commands).toContainEqual(['sf', 'config', 'set', 'target-org=globexqa', '--json'])
  })

  test('a production target raises the warning band until dismissed, keeping other mods', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'acme' })
    world(on, files)

    await $.command.run({ command: 'og-sf-org', ...RUN })
    const band = await $.ui.mount({
      plugin: 'og-sf-org-status',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    })

    expect(await band.find({ text: /PRODUCTION/ })).toBeDefined()
    expect(await band.find({ text: 'another mod' })).toBeDefined()
    await band.press({ key: 'hide' })
    expect(await band.find({ text: /PRODUCTION/ })).toBeUndefined()
    expect(await band.find({ text: 'another mod' })).toBeDefined()
  })
})

/** The engine's own Bash and question dialog, beneath the guard. */
const shell = (on: On, answers: (string | Error)[]) => {
  const ran: string[] = []
  const asked: string[] = []
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    ran.push(e.command)
    return { result: { stdout: 'ok', stderr: '', interrupted: false, isImage: false } }
  })
  on('tool.call', ($, e, next) => {
    if (e.tool !== 'PowerShell') return next(e)
    ran.push(String((e as { command?: unknown }).command))
    return { result: { stdout: 'ok', stderr: '' } } as never
  })
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const question = e.questions[0]?.question ?? ''
    asked.push(question)
    const answer = answers.shift()
    if (answer === undefined || answer instanceof Error) throw answer ?? new Error('dismissed')
    return { result: { questions: e.questions, answers: { [question]: answer } } }
  })

  return { ran, asked }
}

const bash = (command: string) => ({ tool: 'Bash' as const, command })

describe('guard', () => {
  test('a protected org asks; deny blocks, once runs, 15 min stops asking', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'globexdev' })
    world(on, files)
    const { ran, asked } = shell(on, ['Deny', 'Allow once', 'Allow for 15 min'])

    const denied = await $.tool.call(bash('sf project deploy start -d force-app -o globexqa'))
    expect(denied.deny).toContain('Do not retry')
    expect(asked[0]).toContain('globexqa is a protected org')
    expect(ran).toEqual([])

    await $.tool.call(bash('sf project deploy start -d force-app -o globexqa'))
    await $.tool.call(bash('sf data update record -s Account -i 001 -o globexqa'))
    await $.tool.call(bash('sf apex run -f a.apex -o globexqa'))
    expect(asked).toHaveLength(3)
    expect(ran).toHaveLength(3)
  })

  test('PowerShell writes ask too, with the alias in any case', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'globexdev' })
    world(on, files)
    const { ran, asked } = shell(on, ['Deny', 'Deny'])
    const ps = (command: string) => ({ tool: 'PowerShell', command }) as never

    const update = '$env:PATH = "C:\\nodejs;" + $env:PATH\nsf data update record -s Product2 -i 01t -o GLOBEXQA --values $arg'
    expect((await $.tool.call(ps(update))).deny).toContain('Do not retry')
    const patch = 'sf api request rest "/services/data/v68.0/sobjects/Product2/01t" --method PATCH --body b.json -o globexqa'
    expect((await $.tool.call(ps(patch))).deny).toContain('Do not retry')
    expect(asked).toHaveLength(2)
    expect(asked[1]).toContain('API call that writes')
    expect(ran).toEqual([])
  })

  test('reads and free orgs pass without a question', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'acme' })
    world(on, files)
    const { ran, asked } = shell(on, [])

    await $.tool.call(bash('sf data query -q "SELECT Id FROM Account" -o acme'))
    await $.tool.call(bash('sf project deploy start -o globexdev'))
    await $.tool.call(bash('git status'))

    expect(asked).toEqual([])
    expect(ran).toHaveLength(3)
  })

  test('production asks with its own header; only the typed alias lets it run', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'acme' })
    world(on, files)
    const { ran, asked } = shell(on, ['acme', 'acm', 'Deny'])

    expect((await $.tool.call(bash('sf data delete record -s Account -i 001'))).deny).toBeUndefined()
    expect(asked[0]).toContain('Type "acme" under Other to allow data write (DML) in PRODUCTION')
    expect(ran).toHaveLength(1)

    expect((await $.tool.call(bash('sf project deploy start'))).deny).toContain('PRODUCTION')
    expect((await $.tool.call(bash('sf apex run -f a.apex'))).deny).toContain('did not type the production alias')
    expect(ran).toHaveLength(1)
  })

  test('with nobody to ask, production is refused', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'acme' })
    world(on, files)
    const { ran } = shell(on, [new Error('no one to ask')])

    const refused = await $.tool.call(bash('npm run deploy'))

    expect(refused.deny).toContain('nobody confirmed')
    expect(ran).toEqual([])
  })

  test('a command naming a protected org by hand asks too', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'globexdev' })
    world(on, files)
    const { asked } = shell(on, ['Deny'])

    const refused = await $.tool.call(bash('curl -X PATCH https://globex--globexqa.sandbox.my.salesforce.com/services/data'))

    expect(refused.deny).toBeDefined()
    expect(asked[0]).toContain('command naming the org')
  })

  test('reads of a protected org pass: read-only Apex, a GET, files that name it', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'globexqa' })
    files[`${PROJECT}/scripts/count.apex`] = 'System.debug([SELECT COUNT() FROM Product2]);'
    files[`${PROJECT}/scripts/fix.apex`] = 'update [SELECT Id FROM Product2];'
    world(on, files)
    const { ran, asked } = shell(on, ['Deny'])

    await $.tool.call(bash('sf apex run -f scripts/count.apex'))
    await $.tool.call(bash(`echo "System.debug(UserInfo.getUserName());" | sf apex run -o globexqa`))
    await $.tool.call(bash('curl -s https://globex--globexqa.sandbox.my.salesforce.com/services/data/v62.0/limits'))
    await $.tool.call(bash('grep -rn globexqa . && cat .sf/config.json'))
    expect(asked).toEqual([])
    expect(ran).toHaveLength(4)

    expect((await $.tool.call(bash('sf apex run -f scripts/fix.apex'))).deny).toContain('Do not retry')
    expect(asked).toHaveLength(1)
  })

  test('the panel protects, unprotects and downgrades production by its typed alias', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'acme' })
    const { store } = world(on, files)
    store.set(`project:${PROJECT}`, ['me@acme.com', 'me@globex.com.globexdev'])

    await $.command.run({ command: 'og-sf-org', ...RUN })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    await ui.press({ key: 'row:me@globex.com.globexdev' })
    await ui.press({ key: 'protect' })
    expect(store.get('protection')).toEqual({ 'me@globex.com.globexdev': 'protected' })
    expect(await ui.find({ text: /🟡🔒 sandbox/ })).toBeDefined()

    await ui.press({ key: 'row:me@acme.com' })
    await ui.press({ key: 'protect' })
    await ui.input({ key: 'downgrade', text: 'nope' })
    expect(await ui.find({ text: /stays PRODUCTION/ })).toBeDefined()

    await ui.press({ key: 'protect' })
    await ui.input({ key: 'downgrade', text: 'acme' })
    expect(store.get('protection')).toMatchObject({ 'me@acme.com': 'protected' })
    expect(await ui.find({ text: /🔴🔒 PROD↓/ })).toBeDefined()

    await ui.press({ key: 'restore' })
    expect(store.get('protection')).toEqual({ 'me@globex.com.globexdev': 'protected' })
  })
})
