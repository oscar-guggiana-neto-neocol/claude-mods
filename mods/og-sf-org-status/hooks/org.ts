// Pure logic: which org the sf CLI targets from a directory, what kind it is,
// and which orgs belong to a project. No `$` here, so tests drive it with
// in-memory files.

import type { OrgInfo, OrgKind, OrgRow, TargetOrg } from '../types'

/** Reads a file's text, or undefined when it is missing or unreadable. */
export type Reader = (path: string) => Promise<string | undefined>

export type Context = {
  cwd: string
  home: string
  /** SF_TARGET_ORG, or the legacy SFDX_DEFAULTUSERNAME. */
  envTarget?: string
}

export type AuthFile = {
  username?: string
  instanceUrl?: string
  loginUrl?: string
  isScratch?: boolean
  isSandbox?: boolean
  devHubUsername?: string
}

export const parse = <T>(text: string | undefined): T | undefined => {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

// Paths may be POSIX (`/work/app`) or Windows (`C:\\work\\app`): both separators count.
const isRoot = (dir: string) => /^([A-Za-z]:)?[\\/]*$/.test(dir)

export const parentOf = (dir: string) => {
  const trimmed = dir.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut < 0) return dir
  const parent = trimmed.slice(0, cut)
  if (parent === '') return dir[0] === '\\' ? '\\' : '/'

  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent
}

export const baseName = (dir: string) => dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir

/** The nearest directory at or above `cwd` holding sfdx-project.json. */
export const findProjectRoot = async (read: Reader, cwd: string) => {
  for (let dir = cwd; ; dir = parentOf(dir)) {
    if ((await read(`${dir.replace(/[\\/]+$/, '')}/sfdx-project.json`)) !== undefined) return dir
    if (isRoot(dir) || parentOf(dir) === dir) return undefined
  }
}

/** target-org from a `.sf/config.json`, else defaultusername from the legacy file. */
const targetIn = async (read: Reader, dir: string) =>
  parse<Record<string, string>>(await read(`${dir}/.sf/config.json`))?.['target-org'] ??
  parse<Record<string, string>>(await read(`${dir}/.sfdx/sfdx-config.json`))?.defaultusername

export const aliasesIn = (text: string | undefined) =>
  parse<{ orgs?: Record<string, string> }>(text)?.orgs ?? {}

export const classify = (auth: AuthFile | undefined): OrgKind => {
  if (auth === undefined) return 'unknown'
  const url = auth.instanceUrl ?? ''
  if (auth.isScratch === true || /\.scratch\.my\.salesforce\.com/.test(url)) return 'scratch'
  if (
    auth.isSandbox === true ||
    /\.sandbox\.my\.salesforce\.com|--/.test(url) ||
    /test\.salesforce\.com/.test(auth.loginUrl ?? '')
  )
    return 'sandbox'
  if (/\.develop\.my\.salesforce\.com|-dev-ed\./.test(url)) return 'developer'
  return 'production'
}

/**
 * The org the sf CLI would target from `cwd`, or undefined outside a
 * Salesforce DX project or when nothing is set.
 */
export const resolveTargetOrg = async (
  read: Reader,
  { cwd, home, envTarget }: Context,
): Promise<TargetOrg | undefined> => {
  const root = await findProjectRoot(read, cwd)
  if (root === undefined) return undefined

  let target: string | undefined
  let source: TargetOrg['source']
  if (envTarget) {
    target = envTarget
    source = 'env'
  } else if ((target = await targetIn(read, root))) {
    source = 'project'
  } else if ((target = await targetIn(read, home))) {
    source = 'global'
  } else {
    return undefined
  }

  const aliases = aliasesIn(await read(`${home}/.sfdx/alias.json`))
  const username = aliases[target] ?? target
  const alias = aliases[target] !== undefined ? target : undefined
  const auth = parse<AuthFile>(await read(`${home}/.sfdx/${username}.json`))

  return { target, alias, username, kind: classify(auth), instanceUrl: auth?.instanceUrl, source }
}

// Labels that end a company domain inside a username (`globex.com.globexqa`).
const TLDS = new Set(['com', 'org', 'net', 'io', 'co', 'dev', 'ai', 'app', 'br'])
// Domains every scratch org shares, which say nothing about the client.
const GENERIC = new Set(['example.com', 'example.org', 'salesforce.com'])

/** The company domain of a username: `oscar@globex.com.globexqa` → `globex.com`. */
export const domainOf = (username: string) => {
  const labels = username.slice(username.indexOf('@') + 1).toLowerCase().split('.')
  const end = labels.findIndex((label, i) => i > 0 && TLDS.has(label))
  if (end < 0) return undefined
  const last = labels[end + 1] === 'br' ? end + 1 : end
  const domain = labels.slice(0, last + 1).join('.')
  return GENERIC.has(domain) ? undefined : domain
}

/** One row per auth file, its alias the first one pointing at it. */
export const buildCatalog = (auths: AuthFile[], aliases: Record<string, string>): OrgRow[] => {
  const firstAlias = new Map<string, string>()
  for (const [alias, username] of Object.entries(aliases)) {
    if (alias !== 'DEFAULT_TARGET_ORG' && !firstAlias.has(username)) firstAlias.set(username, alias)
  }

  return auths
    .filter((auth): auth is AuthFile & { username: string } => typeof auth.username === 'string')
    .map(auth => ({
      username: auth.username,
      alias: firstAlias.get(auth.username),
      kind: classify(auth),
      instanceUrl: auth.instanceUrl,
      domain: domainOf(auth.devHubUsername ?? auth.username),
    }))
    .sort((a, b) =>
      `${a.domain ?? '~'} ${a.alias ?? a.username}`.localeCompare(`${b.domain ?? '~'} ${b.alias ?? b.username}`),
    )
}

/** The project's orgs when none were saved: the current org's domain mates. */
export const inferProjectOrgs = (catalog: OrgRow[], current: TargetOrg | undefined): OrgRow[] => {
  if (current === undefined) return []
  const domain = catalog.find(row => row.username === current.username)?.domain ?? domainOf(current.username)
  const mates = domain === undefined ? [] : catalog.filter(row => row.domain === domain)
  const hasCurrent = mates.some(row => row.username === current.username)

  return hasCurrent
    ? mates
    : [
        { username: current.username, alias: current.alias, kind: current.kind, instanceUrl: current.instanceUrl, domain },
        ...mates,
      ]
}

/** The rows of a saved list, in its order, kept even when no longer authenticated. */
export const savedProjectOrgs = (catalog: OrgRow[], usernames: string[]): OrgRow[] =>
  usernames.map(
    username => catalog.find(row => row.username === username) ?? { username, kind: 'unknown' as const },
  )

/** Info from `sf org display --json` and an Organization query's `--json`. */
export const parseInfo = (displayJson: string, queryJson: string | undefined): OrgInfo => {
  const display = parse<{ status?: number; message?: string; result?: Record<string, unknown> }>(displayJson)
  if (display?.result === undefined) {
    return { status: 'error', message: display?.message ?? 'sf org display falhou' }
  }
  const org = parse<{ result?: { records?: Record<string, unknown>[] } }>(queryJson)?.result?.records?.[0]
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined)

  return {
    status: 'ok',
    orgId: text(display.result.id),
    apiVersion: text(display.result.apiVersion),
    connectedStatus: text(display.result.connectedStatus),
    edition: text(org?.OrganizationType),
    pod: text(org?.InstanceName),
    expires: text(display.result.expirationDate) ?? text(org?.TrialExpirationDate)?.slice(0, 10),
  }
}

export const BADGE: Record<OrgKind, string> = {
  production: '🔴 PROD',
  sandbox: '🟡 sandbox',
  scratch: '🟢 scratch',
  developer: '🔵 dev-ed',
  unknown: '⚪ não autenticada',
}

/** The badge with the guard's marks: `🟡🔒 sandbox`, `🔴 PROD↓` for a downgraded production. */
export const badgeOf = (kind: OrgKind, protection?: { level: string; isDowngraded: boolean }) => {
  const [emoji, ...rest] = BADGE[kind].split(' ')
  const lock = protection?.level === 'protected' ? '🔒' : ''
  const label = rest.join(' ') + (protection?.isDowngraded ? '↓' : '')

  return `${emoji}${lock} ${label}`
}

export const statusText = (org: TargetOrg, protection?: { level: string; isDowngraded: boolean }) =>
  `SF ${badgeOf(org.kind, protection)} · ${org.alias ?? org.username}`

export const explain = (org: TargetOrg | undefined) =>
  org === undefined
    ? 'Nenhuma org alvo: fora de um projeto Salesforce DX ou sem target-org configurada.'
    : [
        `Org alvo: ${org.alias ?? org.username} (${org.kind})`,
        `Username: ${org.username}`,
        org.instanceUrl && `Instance: ${org.instanceUrl}`,
        `Origem: ${{ env: 'variável SF_TARGET_ORG', project: '.sf/config.json do projeto', global: '~/.sf/config.json' }[org.source]}`,
      ]
        .filter(Boolean)
        .join('\n')
