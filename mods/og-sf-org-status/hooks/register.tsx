import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OrgInfo, OrgRow, Panel, TargetOrg } from '../types'
import {
  BADGE,
  aliasesIn,
  baseName,
  buildCatalog,
  explain,
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
const SF_COMMAND = /(^|[\s;&|(])(sf|sfdx)\s/
const ORG_QUERY = 'SELECT OrganizationType, InstanceName, TrialExpirationDate FROM Organization'

const current = atom({ plugin: 'og-sf-org-status', key: 'current' } as const, null)
const panel = atom({ plugin: 'og-sf-org-status', key: 'panel' } as const, null)
const selected = atom({ plugin: 'og-sf-org-status', key: 'selected' } as const, null)
const editing = atom({ plugin: 'og-sf-org-status', key: 'editing' } as const, null)
const info = atom({ plugin: 'og-sf-org-status', key: 'info' } as const, {})
const message = atom({ plugin: 'og-sf-org-status', key: 'message' } as const, null)
const bandDismissed = atom({ plugin: 'og-sf-org-status', key: 'bandDismissed' } as const, null)

// The status text last shown, so an unchanged org draws nothing.
let shown: string | undefined

const projectKey = (root: string) => `project:${root}`
const nameOf = (row: { alias?: string; username: string }) => row.alias ?? row.username
const firstLine = (text: string) => text.trim().split('\n')[0] ?? ''

async function readText($: EngineInterface, path: string) {
  return $.fs.read(path).then(String, () => undefined)
}

async function where($: EngineInterface) {
  const [cwd, home, sfTarget, legacyTarget] = await Promise.all([
    $.session.cwd(),
    $.env.get('HOME'),
    $.env.get('SF_TARGET_ORG'),
    $.env.get('SFDX_DEFAULTUSERNAME'),
  ])

  return { cwd, home, envTarget: sfTarget ?? legacyTarget }
}

async function refresh($: EngineInterface) {
  const { cwd, home, envTarget } = await where($)
  const org = home === undefined ? undefined : await resolveTargetOrg(path => readText($, path), { cwd, home, envTarget })
  await update($, current, () => org ?? null)
  const text = org && statusText(org)
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

  return buildCatalog(auths, aliasesIn(await readText($, `${dir}/alias.json`)))
}

async function loadPanel($: EngineInterface) {
  const { cwd, home } = await where($)
  const root = await findProjectRoot(path => readText($, path), cwd)
  if (home === undefined || root === undefined) {
    await update($, panel, () => null)
    return undefined
  }
  const [org, catalog, saved] = await Promise.all([
    refresh($),
    loadCatalog($, home),
    $.store.get(projectKey(root)),
  ])
  const savedList = Array.isArray(saved) ? saved.filter((u): u is string => typeof u === 'string') : undefined
  const project = parse<{ name?: string }>(await readText($, `${root}/sfdx-project.json`))
  const next: Panel = {
    root,
    name: project?.name ?? baseName(root),
    orgs: savedList ? savedProjectOrgs(catalog, savedList) : inferProjectOrgs(catalog, org),
    listSource: savedList ? 'saved' : 'inferred',
    catalog,
  }
  await update($, panel, () => next)
  const pick = (await read($, selected)) ?? org?.username ?? next.orgs[0]?.username ?? null
  if (pick !== null) await select($, pick)

  return next
}

async function openPanel($: EngineInterface) {
  await update($, message, () => null)
  await update($, editing, () => null)
  await $.ui.open({ id: PANE, title: 'Salesforce orgs', focus: true, closeOnEscape: true })
  await loadPanel($)
}

async function loadInfo($: EngineInterface, username: string) {
  await update($, info, all => ({ ...all, [username]: { status: 'loading' as const } }))
  const run = (argv: string[]) =>
    $.process.run(argv, { timeoutMs: 60_000 }).then(
      ran => ran.stdout,
      () => undefined,
    )
  const [display, query] = await Promise.all([
    run(['sf', 'org', 'display', '-o', username, '--json']),
    run(['sf', 'data', 'query', '-o', username, '-q', ORG_QUERY, '--json']),
  ])
  const found: OrgInfo =
    display === undefined ? { status: 'error', message: 'sf CLI não encontrado ou sem resposta' } : parseInfo(display, query)
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
  await update($, message, () => `Definindo ${nameOf(row)} como org alvo…`)
  const ran = await $.process
    .run(['sf', 'config', 'set', `target-org=${nameOf(row)}`, '--json'], { cwd: shown.root })
    .catch(error => ({ exitCode: 1, stdout: '', stderr: String(error) }))
  if (ran.exitCode !== 0) {
    const reason = parse<{ message?: string }>(ran.stdout)?.message ?? firstLine(ran.stderr)
    await update($, message, () => `Falhou: ${reason}`)
    return
  }
  const org = await refresh($)
  await update($, message, () =>
    org?.source === 'env'
      ? `Salvo no projeto, mas SF_TARGET_ORG (${org.target}) continua tendo precedência.`
      : `Org alvo agora: ${nameOf(row)}`,
  )
}

async function openInBrowser($: EngineInterface, row: OrgRow) {
  await update($, message, () => `Abrindo ${nameOf(row)} no browser…`)
  const ran = await $.process
    .run(['sf', 'org', 'open', '-o', row.username, '--json'], { timeoutMs: 60_000 })
    .catch(error => ({ exitCode: 1, stdout: '', stderr: String(error) }))
  await update($, message, () =>
    ran.exitCode === 0
      ? `${nameOf(row)} aberta no browser.`
      : `Falhou: ${parse<{ message?: string }>(ran.stdout)?.message ?? firstLine(ran.stderr)}`,
  )
}

async function saveList($: EngineInterface, usernames: string[]) {
  const shown = await read($, panel)
  if (shown === null) return
  await $.store.set(projectKey(shown.root), usernames)
  await update($, editing, () => null)
  await update($, message, () => `Lista salva: ${usernames.length} org(s) para ${shown.name}.`)
  await loadPanel($)
}

async function switchTo($: EngineInterface, name: string) {
  const loaded = await loadPanel($)
  if (loaded === undefined) return 'Fora de um projeto Salesforce DX.'
  const row = loaded.catalog.find(one => one.alias === name || one.username === name)
  if (row === undefined) return `Nenhuma org autenticada com alias ou username "${name}".`
  await makeTarget($, row)

  return (await read($, message)) ?? ''
}

function infoLine(found: OrgInfo | undefined) {
  if (found === undefined || found.status === 'loading') return 'carregando info…'
  if (found.status === 'error') return `info indisponível: ${found.message}`

  return [
    found.edition,
    found.apiVersion && `API ${found.apiVersion}`,
    found.pod && `pod ${found.pod}`,
    found.connectedStatus,
    found.expires && `expira ${found.expires}`,
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
      description: 'Painel de orgs Salesforce do projeto (ou /og-sf-org <alias> para trocar)',
      argumentHint: '[alias]',
    })
    await refresh($)
    // Catches changes made outside the session: another terminal, VS Code.
    $.clock.every(POLL_MS, () => void refresh($))

    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const name = e.args.trim()
    if (name !== '') return { text: await switchTo($, name) }
    await openPanel($)

    return { text: explain(await refresh($)) }
  }).catch(() => ({ text: 'og-sf-org-status: não consegui ler a configuração do sf CLI.' }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (SF_COMMAND.test(e.command)) await refresh($)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [shownPanel, target, pick, checked, infos, note] = await Promise.all([
      read($, panel),
      read($, current),
      read($, selected),
      read($, editing),
      read($, info),
      read($, message),
    ])

    if (shownPanel === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Fora de um projeto Salesforce DX (nenhum sfdx-project.json acima do diretório).</Text>
        </Box>
      )
    }

    if (checked !== null) {
      const groups = new Map<string, OrgRow[]>()
      for (const row of shownPanel.catalog) {
        const group = row.domain ?? 'outros'
        groups.set(group, [...(groups.get(group) ?? []), row])
      }

      return (
        <Box flexDirection="column">
          <Text bold>Orgs do projeto {shownPanel.name}: marque as que pertencem a ele</Text>
          <Text dimColor>Tab navega · Enter marca/desmarca · s salva · c cancela</Text>
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
                  {checked.includes(row.username) ? '[x]' : '[ ]'} {BADGE[row.kind]} <Text bold>{nameOf(row)}</Text>{' '}
                  <Text dimColor>{row.username}</Text>
                </Button>
              ))}
            </Box>
          ))}
          <Box marginTop={1} gap={1}>
            <Button key="save" label={`Salvar (${checked.length})`} hotkey="s" variant="primary" onPress={() => saveList($, checked)} />
            <Button key="cancel" label="Cancelar" hotkey="c" onPress={() => update($, editing, () => null)} />
          </Box>
        </Box>
      )
    }

    const row = shownPanel.orgs.find(one => one.username === pick) ?? shownPanel.orgs[0]

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{shownPanel.name}</Text>{' '}
          <Text dimColor>
            {shownPanel.listSource === 'saved'
              ? '· lista salva'
              : '· lista inferida pelo domínio do username (não salva)'}
          </Text>
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {shownPanel.orgs.length === 0 && <Text dimColor>Nenhuma org. Use Editar lista.</Text>}
          {shownPanel.orgs.map(one => (
            <Button key={`row:${one.username}`} plain onPress={() => select($, one.username)}>
              {one.username === row?.username ? '›' : ' '} {BADGE[one.kind]} <Text bold>{nameOf(one)}</Text>{' '}
              <Text dimColor>{one.username}</Text>
              {one.username === target?.username ? <Text color="success"> ← alvo</Text> : ''}
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
            <Button key="target" label="Tornar alvo" hotkey="t" variant="primary" onPress={() => makeTarget($, row)} />
          )}
          {row && <Button key="open" label="Abrir no browser" hotkey="o" onPress={() => openInBrowser($, row)} />}
          {row && <Button key="info" label="Atualizar info" hotkey="i" onPress={() => loadInfo($, row.username)} />}
          <Button
            key="edit"
            label="Editar lista"
            hotkey="e"
            onPress={() => update($, editing, () => shownPanel.orgs.map(one => one.username))}
          />
          {shownPanel.listSource === 'inferred' && shownPanel.orgs.length > 0 && (
            <Button key="keep" label="Salvar lista" hotkey="s" onPress={() => saveList($, shownPanel.orgs.map(one => one.username))} />
          )}
        </Box>
        {note && (
          <Box marginTop={1}>
            <Text color={note.startsWith('Falhou') ? 'error' : 'suggestion'}>{note}</Text>
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // What other mods and Claude Code draw here stays, below the warning.
    const rest = await next(e)
    const [target, dismissed] = await Promise.all([read($, current), read($, bandDismissed)])
    if (e.props.hasSurvey || target === null || target.kind !== 'production' || dismissed === target.username) {
      return rest
    }
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color="error" bold>
            ⚠ PRODUÇÃO
          </Text>
          <Text>
            org alvo: <Text bold>{nameOf(target)}</Text> <Text dimColor>{target.username}</Text>
          </Text>
          <Button key="switch" label="Trocar" onPress={() => openPanel($)} />
          <Button key="hide" label="Ocultar" onPress={() => update($, bandDismissed, () => target.username)} />
        </Box>
        {rest}
      </Box>
    )
  })
}
