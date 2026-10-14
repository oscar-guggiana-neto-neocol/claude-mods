import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OrgInfo, OrgRow, Override, Panel, TargetOrg } from '../types'
import { barCells } from './gradient'
import type { Cell, Palette } from './gradient'
import { LOCK, OPERATION_LABEL, findWrites, mentions, otherCommands, protectionOf } from './guard'
import type { Shell } from './guard'
import type { Protection } from './guard'
import {
  aliasesIn,
  badgeOf,
  baseName,
  buildCatalog,
  explain,
  SOURCE_LABEL,
  findProjectRoot,
  inferProjectOrgs,
  parse,
  parseInfo,
  resolveTargetOrg,
  savedProjectOrgs,
  statusText,
} from './org'
import type { AuthFile } from './org'

const PLUGIN = 'og-sf-org-status'
const COMMAND = 'og-sf-org'
const PANE = 'sf-orgs'
const POLL_MS = 15_000
// sf/sfdx commands that can change the target org or its auth.
const SF_COMMAND = /(^|[\s;&|(\\/])(sf|sfdx)(\.cmd|\.exe)?\s/i
const ORG_QUERY = 'SELECT OrganizationType, InstanceName, TrialExpirationDate FROM Organization'
const PROD_HEADER = '⚠ PRODUCTION'
const PROTECTION_KEY = 'protection'
const WINDOW_MS = 15 * 60_000
const CATALOG_MS = 15_000
const ONCE = 'Allow once'
const FOR_A_WHILE = 'Allow for 15 min'
const DENY = 'Deny'

const current = atom({ plugin: 'og-sf-org-status', key: 'current' } as const, null)
const panel = atom({ plugin: 'og-sf-org-status', key: 'panel' } as const, null)
const selected = atom({ plugin: 'og-sf-org-status', key: 'selected' } as const, null)
const editing = atom({ plugin: 'og-sf-org-status', key: 'editing' } as const, null)
const info = atom({ plugin: 'og-sf-org-status', key: 'info' } as const, {})
const message = atom({ plugin: 'og-sf-org-status', key: 'message' } as const, null)
const bandDismissed = atom({ plugin: 'og-sf-org-status', key: 'bandDismissed' } as const, null)
const protection = atom({ plugin: 'og-sf-org-status', key: 'protection' } as const, {})
const prodAsk = atom({ plugin: 'og-sf-org-status', key: 'prodAsk' } as const, null)
const downgrading = atom({ plugin: 'og-sf-org-status', key: 'downgrading' } as const, null)

// The status text last shown, so an unchanged org draws nothing.
let shown: string | undefined
// The target the 15-minute authorizations were given under; a new target drops them.
let windowTarget: string | undefined
// Protected orgs authorized for a while in this session: username → until.
const windows = new Map<string, number>()
// Every authenticated org and every alias, read at most every 15 s.
let orgs: { at: number; catalog: OrgRow[]; aliases: Record<string, string> } | undefined
// The project's protected orgs, for the system prompt; undefined when none.
let guardSection: string | undefined

const projectKey = (root: string) => `project:${root}`
const nameOf = (row: { alias?: string; username: string }) => row.alias ?? row.username
const firstLine = (text: string) => text.trim().split('\n')[0] ?? ''

async function readText($: EngineInterface, path: string) {
  return $.fs.read(path).then(String, () => undefined)
}

/** The home folder: HOME, or USERPROFILE on Windows, where HOME is often unset. */
async function homeOf($: EngineInterface) {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
}

/**
 * Runs the sf CLI. On Windows `sf` is `sf.cmd`, a batch file a process cannot
 * start without a shell, so it goes through `cmd /c`.
 */
async function runSf($: EngineInterface, args: string[], init?: { cwd?: string; timeoutMs?: number }) {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'

  return $.process.run(isWindows ? ['cmd.exe', '/d', '/s', '/c', 'sf', ...args] : ['sf', ...args], init)
}

async function where($: EngineInterface) {
  const [cwd, home, sfTarget, legacyTarget] = await Promise.all([
    $.session.cwd(),
    homeOf($),
    $.env.get('SF_TARGET_ORG'),
    $.env.get('SFDX_DEFAULTUSERNAME'),
  ])

  return { cwd, home, envTarget: sfTarget ?? legacyTarget }
}

async function loadProtection($: EngineInterface) {
  const stored = await $.store.get(PROTECTION_KEY)
  const marks = stored !== null && typeof stored === 'object' ? (stored as Record<string, Override>) : {}
  await update($, protection, () => marks)

  return marks
}

async function setOverride($: EngineInterface, username: string, value: Override | undefined) {
  const marks = { ...(await read($, protection)) }
  if (value === undefined) delete marks[username]
  else marks[username] = value
  await $.store.set(PROTECTION_KEY, marks)
  await update($, protection, () => marks)
  windows.delete(username)
  await refresh($)
}

async function refresh($: EngineInterface) {
  const { cwd, home, envTarget } = await where($)
  const org = home === undefined ? undefined : await resolveTargetOrg(path => readText($, path), { cwd, home, envTarget })
  await update($, current, () => org ?? null)
  if (org?.username !== windowTarget) {
    windowTarget = org?.username
    windows.clear()
  }
  const marks = await read($, protection)
  const text = org && statusText(org, protectionOf(org, marks[org.username]))
  if (text !== shown) {
    shown = text
    $.ui.status(text)
  }

  return org
}

async function loadCatalog($: EngineInterface, home: string): Promise<OrgRow[]> {
  const dir = `${home}/.sfdx`
  const entries = await $.fs.list(dir).catch(() => [])
  const names = entries.map(entry => entry.name).filter(name => name.endsWith('.json') && name.includes('@'))
  const auths = await Promise.all(names.map(async name => parse<AuthFile>(await readText($, `${dir}/${name}`)) ?? {}))
  const aliases = aliasesIn(await readText($, `${dir}/alias.json`))
  const catalog = buildCatalog(auths, aliases)
  orgs = { at: Date.now(), catalog, aliases }

  return catalog
}

/** The catalog and aliases, from the cache while it is fresh. */
async function knownOrgs($: EngineInterface) {
  if (orgs !== undefined && Date.now() - orgs.at < CATALOG_MS) return orgs
  const home = await homeOf($)
  if (home !== undefined) await loadCatalog($, home)

  return orgs ?? { at: 0, catalog: [], aliases: {} }
}

/** The project's orgs: the saved list, else the target's domain mates. */
async function projectOrgs($: EngineInterface, root: string, catalog: OrgRow[], org: TargetOrg | undefined) {
  const saved = await $.store.get(projectKey(root))
  const savedList = Array.isArray(saved) ? saved.filter((u): u is string => typeof u === 'string') : undefined

  return {
    orgs: savedList ? savedProjectOrgs(catalog, savedList) : inferProjectOrgs(catalog, org),
    listSource: savedList ? ('saved' as const) : ('inferred' as const),
  }
}

/** What the model is told about the project's protected orgs. */
function sectionFor(rows: OrgRow[], marks: Record<string, Override>) {
  const guarded = rows
    .map(row => ({ row, guard: protectionOf(row, marks[row.username]) }))
    .filter(({ guard }) => guard.level !== 'free')
  if (guarded.length === 0) return undefined
  const list = guarded
    .map(({ row, guard }) => `${nameOf(row)} (${row.username}, ${guard.level === 'production' ? 'PRODUCTION' : 'protected'})`)
    .join('; ')

  return [
    `Salesforce org guard (og-sf-org-status): these orgs of the project are protected: ${list}.`,
    'Writes to them (deploy, DML, anonymous Apex, package installs, permission sets, deploy scripts) pause for the user to confirm; production asks the user to type the org alias.',
    'Never work around the guard: do not write to these orgs another way (REST API with curl, a script, another tool or org flag). When the guard denies a command, stop and ask the user how to proceed.',
  ].join(' ')
}

async function refreshGuardSection($: EngineInterface) {
  const { cwd, home } = await where($)
  const root = await findProjectRoot(path => readText($, path), cwd)
  if (home === undefined || root === undefined) {
    guardSection = undefined
    return
  }
  const [{ catalog }, org, marks] = await Promise.all([knownOrgs($), read($, current), read($, protection)])
  const { orgs: rows } = await projectOrgs($, root, catalog, org ?? undefined)
  guardSection = sectionFor(rows, marks)
}

async function loadPanel($: EngineInterface) {
  const { cwd, home } = await where($)
  const root = await findProjectRoot(path => readText($, path), cwd)
  if (home === undefined || root === undefined) {
    await update($, panel, () => null)
    return undefined
  }
  const [org, catalog] = await Promise.all([refresh($), loadCatalog($, home)])
  const project = parse<{ name?: string }>(await readText($, `${root}/sfdx-project.json`))
  const next: Panel = {
    root,
    name: project?.name ?? baseName(root),
    ...(await projectOrgs($, root, catalog, org)),
    catalog,
  }
  await update($, panel, () => next)
  guardSection = sectionFor(next.orgs, await read($, protection))
  const pick = (await read($, selected)) ?? org?.username ?? next.orgs[0]?.username ?? null
  if (pick !== null) await select($, pick)

  return next
}

async function openPanel($: EngineInterface) {
  await update($, message, () => null)
  await update($, editing, () => null)
  const { isPlaced } = await $.ui.open({ id: PANE, title: 'Salesforce orgs', focus: true, closeOnEscape: true })
  await loadPanel($)

  return isPlaced
}

async function loadInfo($: EngineInterface, username: string) {
  await update($, info, all => ({ ...all, [username]: { status: 'loading' as const } }))
  const run = (args: string[]) =>
    runSf($, args, { timeoutMs: 60_000 }).then(
      ran => ran.stdout,
      () => undefined,
    )
  const [display, query] = await Promise.all([
    run(['org', 'display', '-o', username, '--json']),
    run(['data', 'query', '-o', username, '-q', ORG_QUERY, '--json']),
  ])
  const found: OrgInfo =
    display === undefined ? { status: 'error', message: 'sf CLI not found or not responding' } : parseInfo(display, query)
  await update($, info, all => ({ ...all, [username]: found }))
}

async function select($: EngineInterface, username: string) {
  await update($, selected, () => username)
  const known = (await read($, info))[username]
  if (known === undefined || known.status === 'error') await loadInfo($, username)
}

async function makeTarget($: EngineInterface, row: OrgRow) {
  const shown = await read($, panel)
  if (shown === null) return
  await update($, message, () => `Setting ${nameOf(row)} as the target org…`)
  const ran = await runSf($, ['config', 'set', `target-org=${nameOf(row)}`, '--json'], { cwd: shown.root })
    .catch(error => ({ exitCode: 1, stdout: '', stderr: String(error) }))
  if (ran.exitCode !== 0) {
    const reason = parse<{ message?: string }>(ran.stdout)?.message ?? firstLine(ran.stderr)
    await update($, message, () => `Failed: ${reason}`)
    return
  }
  const org = await refresh($)
  await update($, message, () =>
    org?.source === 'env'
      ? `Saved in the project, but SF_TARGET_ORG (${org.target}) still takes precedence.`
      : `Target org now: ${nameOf(row)}`,
  )
}

async function openInBrowser($: EngineInterface, row: OrgRow) {
  await update($, message, () => `Opening ${nameOf(row)} in the browser…`)
  const ran = await runSf($, ['org', 'open', '-o', row.username, '--json'], { timeoutMs: 60_000 })
    .catch(error => ({ exitCode: 1, stdout: '', stderr: String(error) }))
  await update($, message, () =>
    ran.exitCode === 0
      ? `${nameOf(row)} opened in the browser.`
      : `Failed: ${parse<{ message?: string }>(ran.stdout)?.message ?? firstLine(ran.stderr)}`,
  )
}

async function saveList($: EngineInterface, usernames: string[]) {
  const shown = await read($, panel)
  if (shown === null) return
  await $.store.set(projectKey(shown.root), usernames)
  await update($, editing, () => null)
  await update($, message, () => `List saved: ${usernames.length} org(s) for ${shown.name}.`)
  await loadPanel($)
}

async function switchTo($: EngineInterface, name: string) {
  const loaded = await loadPanel($)
  if (loaded === undefined) return 'Outside a Salesforce DX project.'
  const row = loaded.catalog.find(one => one.alias === name || one.username === name)
  if (row === undefined) return `No authenticated org with alias or username "${name}".`
  await makeTarget($, row)

  return (await read($, message)) ?? ''
}

const SHELL_TOOLS: Record<string, Shell> = { Bash: 'bash', PowerShell: 'powershell' }

/** The command a shell tool call runs, and the shell it is written for. */
const shellCall = (e: { tool: string }): { command: string; shell: Shell } | undefined => {
  const shell = SHELL_TOOLS[e.tool]
  const command = (e as { command?: unknown }).command
  return shell !== undefined && typeof command === 'string' ? { command, shell } : undefined
}

type Hit = { row: OrgRow; guard: Protection; operations: string[]; commands: string[] }

/** The guarded orgs a shell command would write to, production first. */
async function hitsOf($: EngineInterface, command: string, shell: Shell): Promise<Hit[]> {
  const writes = findWrites(command, shell)
  const others = otherCommands(command, shell)
  if (writes.length === 0 && others.length === 0) return []
  const [{ catalog, aliases }, marks] = await Promise.all([knownOrgs($), read($, protection)])
  const target = writes.some(write => write.target === undefined) ? await refresh($) : undefined
  const hits = new Map<string, Hit>()
  const add = (row: OrgRow, operation: string, text: string) => {
    const guard = protectionOf(row, marks[row.username])
    if (guard.level === 'free') return
    const hit = hits.get(row.username) ?? { row, guard, operations: [], commands: [] }
    if (!hit.operations.includes(operation)) hit.operations.push(operation)
    if (!hit.commands.includes(text)) hit.commands.push(text)
    hits.set(row.username, hit)
  }
  const rowOf = (name: string): OrgRow | undefined => {
    // An alias typed in another case (`-o qa` for `QA`) is still that org: better to ask than to miss it.
    const alias = Object.keys(aliases).find(one => one === name) ?? Object.keys(aliases).find(one => one.toLowerCase() === name.toLowerCase())
    const username = (alias !== undefined ? aliases[alias] : undefined) ?? name
    return catalog.find(row => row.username.toLowerCase() === username.toLowerCase())
  }

  for (const write of writes) {
    const row =
      write.target !== undefined
        ? rowOf(write.target)
        : target && (rowOf(target.username) ?? { username: target.username, alias: target.alias, kind: target.kind })
    if (row !== undefined) add(row, OPERATION_LABEL[write.operation], write.text)
  }
  for (const text of others) {
    for (const row of catalog) if (mentions(text, row)) add(row, 'command naming the org', text)
  }

  return [...hits.values()].sort((a, b) => Number(b.guard.level === 'production') - Number(a.guard.level === 'production'))
}

const denial = (hit: Hit, why: string) =>
  `Blocked by the Salesforce org guard: ${why} (${hit.operations.join(', ')} on ${nameOf(hit.row)}, ` +
  `${hit.guard.level === 'production' ? 'PRODUCTION' : 'protected org'}). ` +
  'Do not retry the command or work around the guard; ask the user how to proceed.'

/** A protected org: the engine's question, once or for 15 minutes. */
async function askProtected($: EngineInterface, hit: Hit): Promise<string | undefined> {
  const until = windows.get(hit.row.username)
  if (until !== undefined && until > Date.now()) return undefined
  const question =
    `${LOCK} ${nameOf(hit.row)} is a protected org. ${hit.operations.join(', ')}: ` +
    `${hit.commands.join(' ; ')} — allow?`
  const answer = await $.ui
    .ask(question, { header: `${LOCK} Org`, options: [ONCE, FOR_A_WHILE, DENY] })
    .catch(() => undefined)
  if (answer === FOR_A_WHILE) windows.set(hit.row.username, Date.now() + WINDOW_MS)
  if (answer === ONCE || answer === FOR_A_WHILE) return undefined

  return denial(hit, answer === undefined ? 'nobody confirmed the write' : 'the user denied the write')
}

/**
 * Production: a sound, and the engine's question under a red banner; only the
 * alias typed under Other lets it through. The question is a `$` call, so the
 * wait for the person never counts against the hook's 10-second budget.
 */
async function askProduction($: EngineInterface, hit: Hit): Promise<string | undefined> {
  const name = nameOf(hit.row)
  void $.audio.play({ asset: 'sounds/alert.wav' }).catch(() => undefined)
  await update($, prodAsk, () => ({
    name,
    username: hit.row.username,
    operation: hit.operations.join(', '),
    command: hit.commands.join('\n'),
  }))
  const answer = await $.ui
    .ask(`Type "${name}" under Other to allow ${hit.operations.join(', ')} in PRODUCTION. Allow?`, {
      header: PROD_HEADER,
      options: [DENY, 'Cancel'],
    })
    .catch(() => undefined)
  await update($, prodAsk, () => null)
  const typed = answer?.trim()

  return typed === name || typed === hit.row.username
    ? undefined
    : denial(hit, answer === undefined ? 'nobody confirmed the write' : 'the user did not type the production alias')
}

/** Undefined to let the command run, else why it may not. */
async function guard($: EngineInterface, command: string, shell: Shell): Promise<string | undefined> {
  for (const hit of await hitsOf($, command, shell)) {
    const refused = hit.guard.level === 'production' ? await askProduction($, hit) : await askProtected($, hit)
    if (refused !== undefined) return refused
  }

  return undefined
}

async function downgrade($: EngineInterface, row: OrgRow, typed: string) {
  await update($, downgrading, () => null)
  if (typed.trim() !== nameOf(row) && typed.trim() !== row.username) {
    await update($, message, () => `Failed: the typed name does not match; ${nameOf(row)} stays PRODUCTION.`)
    return
  }
  await setOverride($, row.username, 'protected')
  await update($, message, () => `${nameOf(row)} downgraded: now protected (r restores production).`)
}

function infoLine(found: OrgInfo | undefined) {
  if (found === undefined || found.status === 'loading') return 'loading info…'
  if (found.status === 'error') return `info unavailable: ${found.message}`

  return [
    found.edition,
    found.apiVersion && `API ${found.apiVersion}`,
    found.pod && `pod ${found.pod}`,
    found.connectedStatus,
    found.expires && `expires ${found.expires}`,
    found.orgId,
  ]
    .filter(Boolean)
    .join(' · ')
}

export const register: Register = on => {
  shown = undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: COMMAND,
      description: "The project's Salesforce orgs panel (or /og-sf-org <alias> to switch)",
      argumentHint: '[alias]',
    })
    await loadProtection($)
    await refresh($)
    await refreshGuardSection($)
    // Catches changes made outside the session: another terminal, VS Code.
    $.clock.every(POLL_MS, () => void refresh($))

    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const name = e.args.trim()
    if (name !== '') return { text: await switchTo($, name) }
    // The panel shows the target itself; the text is for where no panel is drawn.
    const org = await refresh($)
    return (await openPanel($)) ? {} : { text: explain(org) }
  }).catch(() => ({ text: 'og-sf-org-status: could not read the sf CLI configuration.' }))

  // Every shell tool: Bash, and PowerShell on Windows.
  on('tool.call', async ($, e, next) => {
    const call = shellCall(e)
    if (call === undefined) return next(e)
    // Fails closed: a guard that cannot decide on a write refuses it.
    const refused = await guard($, call.command, call.shell).catch(error =>
      findWrites(call.command, call.shell).length > 0 ? `Blocked: the Salesforce org guard failed (${String(error)}).` : undefined,
    )
    if (refused !== undefined) return { deny: refused }
    const ran = await next(e)
    if (SF_COMMAND.test(call.command)) {
      await refresh($)
      await refreshGuardSection($)
    }

    return ran
  }).catch(($, e, next) => {
    // Past the guard the command already ran: replay it. Before, a write is refused.
    const call = shellCall(e)
    return next.called || call === undefined || findWrites(call.command, call.shell).length === 0
      ? next(e)
      : { deny: 'Blocked: the Salesforce org guard failed.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (guardSection === undefined) return composed

    return {
      sections: [...composed.sections, { id: `${PLUGIN}:guard`, text: guardSection, scope: 'session' as const }],
    }
  }).catch(($, e, next) => next(e))

  // The production question, under a banner nobody reads past by accident.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const drawn = await next(e)
    const [first] = e.props.questions as { header?: string }[]
    const ask = first?.header === PROD_HEADER ? await read($, prodAsk) : null
    if (ask === null) return drawn
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Box backgroundColor="error" paddingX={1} flexDirection="column">
          <Text color="inverseText" bold>
            {`⚠ ⚠ ⚠  PRODUCTION · ${ask.name.toUpperCase()}  ⚠ ⚠ ⚠`}
          </Text>
          <Text color="inverseText">Claude wants to run {ask.operation} on a PRODUCTION org.</Text>
        </Box>
        <Box flexDirection="column" marginY={1}>
          <Text>
            Org: <Text bold>{ask.name}</Text> <Text dimColor>{ask.username}</Text>
          </Text>
          <Text color="error">{ask.command}</Text>
          <Text dimColor>Only the alias typed under Other allows it. Any other answer denies.</Text>
        </Box>
        {drawn}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const [shownPanel, target, pick, checked, infos, note, marks, lowering] = await Promise.all([
      read($, panel),
      read($, current),
      read($, selected),
      read($, editing),
      read($, info),
      read($, message),
      read($, protection),
      read($, downgrading),
    ])
    const guardOf = (row: OrgRow) => protectionOf(row, marks[row.username])

    // A gradient bar above and below marks where the mod's display starts and ends;
    // its colors follow how guarded the target org is.
    const palette: Palette = target === null ? 'free' : protectionOf(target, marks[target.username]).level
    const width = Math.max(20, Math.min(e.props.bodyColumns, 120))
    const bar = (cells: Cell[], key: string) => (
      <Text key={key}>
        {cells.map((cell, i) => (
          <Text key={`${key}:${i}`} color={cell.color} bold={cell.isBold}>
            {cell.char}
          </Text>
        ))}
      </Text>
    )
    const frame = (body: unknown) => (
      <Box flexDirection="column">
        {bar(barCells(width, palette, '☁ og-sf-org-status'), 'top')}
        {body}
        {bar(barCells(width, palette).reverse(), 'bottom')}
      </Box>
    )

    if (shownPanel === null) {
      return frame(
        <Box flexDirection="column">
          <Text dimColor>Outside a Salesforce DX project (no sfdx-project.json above the directory).</Text>
        </Box>
      )
    }

    if (checked !== null) {
      const groups = new Map<string, OrgRow[]>()
      for (const row of shownPanel.catalog) {
        const group = row.domain ?? 'other'
        groups.set(group, [...(groups.get(group) ?? []), row])
      }

      return frame(
        <Box flexDirection="column">
          <Text bold>Orgs of project {shownPanel.name}: check the ones that belong to it</Text>
          <Text dimColor>Tab moves · Enter checks/unchecks · s saves · c cancels</Text>
          {[...groups].map(([group, rows]) => (
            <Box key={`group:${group}`} flexDirection="column" marginTop={1}>
              <Text dimColor>{group}</Text>
              {rows.map(row => (
                <Button
                  key={`check:${row.username}`}
                  plain
                  onPress={() =>
                    update($, editing, list =>
                      list === null
                        ? list
                        : list.includes(row.username)
                          ? list.filter(u => u !== row.username)
                          : [...list, row.username],
                    )
                  }
                >
                  {checked.includes(row.username) ? '[x]' : '[ ]'} {badgeOf(row.kind, guardOf(row))} <Text bold>{nameOf(row)}</Text>{' '}
                  <Text dimColor>{row.username}</Text>
                </Button>
              ))}
            </Box>
          ))}
          <Box marginTop={1} gap={1}>
            <Button key="save" label={`Save (${checked.length})`} hotkey="s" variant="primary" onPress={() => saveList($, checked)} />
            <Button key="cancel" label="Cancel" hotkey="c" onPress={() => update($, editing, () => null)} />
          </Box>
        </Box>
      )
    }

    const row = shownPanel.orgs.find(one => one.username === pick) ?? shownPanel.orgs[0]
    const rowGuard = row && guardOf(row)

    if (row && lowering === row.username) {
      return frame(
        <Box flexDirection="column">
          <Text color="error" bold>
            Downgrade {nameOf(row)}: it is classified as PRODUCTION.
          </Text>
          <Text>Only do this if it is not real production (demo, SDO, Trailhead Playground). It stays protected.</Text>
          {Input && (
            <Box marginTop={1}>
              <Input
                key="downgrade"
                label={`Type ${nameOf(row)} to confirm: `}
                placeholder={nameOf(row)}
                submitLabel="downgrade"
                autoFocus
                onSubmit={(value: string) => downgrade($, row, value)}
              />
            </Box>
          )}
          <Box marginTop={1}>
            <Button key="cancel-downgrade" label="Cancel" hotkey="c" onPress={() => update($, downgrading, () => null)} />
          </Box>
        </Box>
      )
    }

    return frame(
      <Box flexDirection="column">
        <Text>
          <Text bold>{shownPanel.name}</Text>{' '}
          <Text dimColor>
            {shownPanel.listSource === 'saved'
              ? '· saved list'
              : "· list inferred from the username's domain (not saved)"}
          </Text>
        </Text>
        {target ? (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              Target: <Text bold>{nameOf(target)}</Text> {badgeOf(target.kind, protectionOf(target, marks[target.username]))}{' '}
              <Text dimColor>· from {SOURCE_LABEL[target.source]}</Text>
            </Text>
            <Text dimColor>
              {target.username}
              {target.instanceUrl ? ` · ${target.instanceUrl}` : ''}
            </Text>
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text dimColor>No target org set.</Text>
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          {shownPanel.orgs.length === 0 && <Text dimColor>No orgs. Use Edit list.</Text>}
          {shownPanel.orgs.map(one => (
            <Button key={`row:${one.username}`} plain onPress={() => select($, one.username)}>
              {one.username === row?.username ? '›' : ' '} {badgeOf(one.kind, guardOf(one))} <Text bold>{nameOf(one)}</Text>{' '}
              <Text dimColor>{one.username}</Text>
              {guardOf(one).isAuto ? <Text dimColor> (auto)</Text> : ''}
              {one.username === target?.username ? <Text color="success"> ← target</Text> : ''}
            </Button>
          ))}
        </Box>
        {row && (
          <Box marginTop={1}>
            <Text dimColor>{infoLine(infos[row.username])}</Text>
          </Box>
        )}
        <Box marginTop={1} gap={1} flexWrap="wrap">
          {row && row.username !== target?.username && (
            <Button key="target" label="Make target" hotkey="t" variant="primary" onPress={() => makeTarget($, row)} />
          )}
          {row && <Button key="open" label="Open in browser" hotkey="o" onPress={() => openInBrowser($, row)} />}
          {row && <Button key="info" label="Refresh info" hotkey="i" onPress={() => loadInfo($, row.username)} />}
          {row && rowGuard && (
            <Button
              key="protect"
              label={
                rowGuard.level === 'production'
                  ? 'Downgrade production'
                  : rowGuard.level === 'protected'
                    ? 'Unprotect'
                    : 'Protect'
              }
              hotkey="p"
              onPress={() =>
                rowGuard.level === 'production'
                  ? update($, downgrading, () => row.username)
                  : setOverride($, row.username, rowGuard.level === 'protected' ? 'free' : 'protected')
              }
            />
          )}
          {row && rowGuard?.isDowngraded && (
            <Button key="restore" label="Restore production" hotkey="r" onPress={() => setOverride($, row.username, undefined)} />
          )}
          <Button
            key="edit"
            label="Edit list"
            hotkey="e"
            onPress={() => update($, editing, () => shownPanel.orgs.map(one => one.username))}
          />
          {shownPanel.listSource === 'inferred' && shownPanel.orgs.length > 0 && (
            <Button key="keep" label="Save list" hotkey="s" onPress={() => saveList($, shownPanel.orgs.map(one => one.username))} />
          )}
        </Box>
        {note && (
          <Box marginTop={1}>
            <Text color={note.startsWith('Failed') ? 'error' : 'suggestion'}>{note}</Text>
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // What other mods and Claude Code draw here stays, below the warning.
    const rest = await next(e)
    const [target, dismissed, marks] = await Promise.all([read($, current), read($, bandDismissed), read($, protection)])
    const isProduction = target !== null && protectionOf(target, marks[target.username]).level === 'production'
    if (e.props.hasSurvey || target === null || !isProduction || dismissed === target.username) {
      return rest
    }
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color="error" bold>
            ⚠ PRODUCTION
          </Text>
          <Text>
            target org: <Text bold>{nameOf(target)}</Text> <Text dimColor>{target.username}</Text>
          </Text>
          <Button key="switch" label="Switch" onPress={() => openPanel($)} />
          <Button key="hide" label="Hide" onPress={() => update($, bandDismissed, () => target.username)} />
        </Box>
        {rest}
      </Box>
    )
  })
}
