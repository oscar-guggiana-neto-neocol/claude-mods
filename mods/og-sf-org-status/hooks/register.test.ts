import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { buildCatalog, classify, domainOf, inferProjectOrgs, parseInfo, resolveTargetOrg, statusText } from './org'

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
const world = (on: On, files: Record<string, string>) => {
  const statuses: (string | undefined)[] = []
  const commands: string[][] = []
  const store = new Map<string, unknown>()

  mock.env(on, { HOME })
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: PROJECT }))
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
    const [, noun, verb] = e.argv
    if (noun === 'config' && verb === 'set') {
      const target = e.argv[3]?.replace('target-org=', '')
      files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': target })
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
  on('ui.open', () => ({ value: { isPlaced: true } }))

  // What another mod draws in the band, beneath this one.
  on('ui.render', { component: 'AbovePrompt' }, $ => ({ type: 'Text', props: {}, children: ['outro mod'] }))

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
  test('/og-sf-org sets the status line and explains the org', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'acme' })
    const { statuses } = world(on, files)

    const { text } = await $.command.run({ command: 'og-sf-org', ...RUN })

    expect(statuses).toEqual(['SF 🔴 PROD · acme'])
    expect(text).toContain('Org alvo: acme (production)')
    expect(text).toContain('.sf/config.json do projeto')
  })

  test('the pane lists the inferred orgs and switches the target', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'globexdev' })
    const { statuses, commands } = world(on, files)

    await $.command.run({ command: 'og-sf-org', ...RUN })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ text: /lista inferida/ })).toBeDefined()
      expect(await ui.find({ key: 'row:me@globex.com.globexqa' })).toBeDefined()
      expect(await ui.find({ key: 'row:me@acme.com' })).toBeUndefined()
      expect(await ui.find({ text: /Enterprise Edition · API 68.0 · pod NA1/ })).toBeDefined()
      await ui.unmount()
    }

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'row:me@globex.com.globexqa' })
    await ui.press({ key: 'target' })

    expect(commands).toContainEqual(['sf', 'config', 'set', 'target-org=globexqa', '--json'])
    expect(statuses.at(-1)).toBe('SF 🟡 sandbox · globexqa')
    expect(await ui.find({ text: /Org alvo agora: globexqa/ })).toBeDefined()
  })

  test('editing the list saves it for the project', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'globexdev' })
    const { store } = world(on, files)

    await $.command.run({ command: 'og-sf-org', ...RUN })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'edit' })
    expect(await ui.find({ text: /Enter marca\/desmarca/ })).toBeDefined()
    await ui.press({ key: 'check:me@globex.com.globexqa' })
    await ui.press({ key: 'save' })

    expect(store.get(`project:${PROJECT}`)).toEqual(['me@globex.com.globexdev'])
    expect(await ui.find({ text: /lista salva/ })).toBeDefined()
    expect(await ui.find({ key: 'row:me@globex.com.globexqa' })).toBeUndefined()
  })

  test('/og-sf-org <alias> switches without the pane', async ($, on) => {
    const files = baseFiles()
    files[`${PROJECT}/.sf/config.json`] = JSON.stringify({ 'target-org': 'globexdev' })
    const { commands } = world(on, files)

    const { text } = await $.command.run({ command: 'og-sf-org', ...RUN, args: 'globexqa' })

    expect(text).toBe('Org alvo agora: globexqa')
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

    expect(await band.find({ text: /PRODUÇÃO/ })).toBeDefined()
    expect(await band.find({ text: 'outro mod' })).toBeDefined()
    await band.press({ key: 'hide' })
    expect(await band.find({ text: /PRODUÇÃO/ })).toBeUndefined()
    expect(await band.find({ text: 'outro mod' })).toBeDefined()
  })
})
