// Pure logic of the production guard: how protected an org is, and which
// orgs a Bash command would write to. No `$` here, so tests drive it alone.

import type { OrgKind, Override, ProtectionLevel } from '../types'

export type Protection = {
  level: ProtectionLevel
  /** Protected by the environment-name rule, not by a mark of the person's. */
  isAuto: boolean
  /** A production org the person marked as not really production (demo, SDO). */
  isDowngraded: boolean
}

// Names that say "shared environment": uat, qa, staging and so on.
const ENVIRONMENTS = ['uat', 'qa', 'stg', 'staging', 'preprod', 'full', 'partial']

/** The sandbox suffix of a username (`me@globex.com.globexqa` → `globexqa`), when it has one. */
const sandboxSuffix = (username: string) => {
  const labels = username.slice(username.indexOf('@') + 1).split('.')
  return labels.length > 2 ? labels[labels.length - 1] : undefined
}

/**
 * An alias names the environment as a word (`acme-uat`); a sandbox suffix is
 * often glued to the client (`globexqa`, `initechuat`), so there it may start or end it;
 * a number after it counts too (`QA3`, `uat2`).
 */
export const looksLikeEnvironment = (org: { username: string; alias?: string }) => {
  const words = (org.alias ?? '').toLowerCase().split(/[^a-z0-9]+/)
  const suffix = sandboxSuffix(org.username)?.toLowerCase()

  return ENVIRONMENTS.some(
    env =>
      words.some(word => word.replace(/\d+$/, '') === env) ||
      (suffix !== undefined && (suffix.startsWith(env) || suffix.replace(/\d+$/, '').endsWith(env))),
  )
}

/** How protected an org is: its kind and name, then the person's mark over them. */
export const protectionOf = (org: { username: string; alias?: string; kind: OrgKind }, override?: Override): Protection => {
  if (org.kind === 'production') {
    return override === undefined
      ? { level: 'production', isAuto: false, isDowngraded: false }
      : { level: override, isAuto: false, isDowngraded: true }
  }
  if (override !== undefined) return { level: override, isAuto: false, isDowngraded: false }
  const isAuto = org.kind === 'sandbox' && looksLikeEnvironment(org)

  return { level: isAuto ? 'protected' : 'free', isAuto, isDowngraded: false }
}

export const LOCK = '🔒'

// --- Reading a Bash command -------------------------------------------------

/** One simple command: its words, quotes removed. */
type Words = string[]

/**
 * The shell a command line is written for. PowerShell keeps `\` literal (Windows
 * paths) and escapes with the backtick, which in bash runs a command instead.
 */
export type Shell = 'bash' | 'powershell'

/** Splits a command line into simple commands: `&&`, `||`, `;`, `|`, `&`, newlines, parentheses, `$(`, and in bash backticks. */
export const splitCommands = (line: string, shell: Shell = 'bash'): Words[] => {
  const escapeChar = shell === 'powershell' ? '`' : '\\'
  const commands: Words[] = []
  let words: Words = []
  let word = ''
  let hasWord = false
  const endWord = () => {
    if (hasWord) words.push(word)
    word = ''
    hasWord = false
  }
  const endCommand = () => {
    endWord()
    if (words.length > 0) commands.push(words)
    words = []
  }

  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string
    if (c === "'") {
      const end = line.indexOf("'", i + 1)
      word += line.slice(i + 1, end < 0 ? line.length : end)
      hasWord = true
      i = end < 0 ? line.length : end
    } else if (c === '"') {
      i++
      while (i < line.length && line[i] !== '"') {
        if (line[i] === escapeChar && i + 1 < line.length) i++
        word += line[i]
        i++
      }
      hasWord = true
    } else if (c === escapeChar && i + 1 < line.length) {
      // A PowerShell backtick before a newline only continues the line.
      if (line[i + 1] !== '\n') word += line[i + 1]
      hasWord = hasWord || line[i + 1] !== '\n'
      i++
    } else if (c === ' ' || c === '\t') {
      endWord()
    } else if (';&|\n()'.includes(c) || (c === '`' && shell === 'bash') || (c === '$' && line[i + 1] === '(')) {
      endCommand()
      if (c === '$') i++
    } else {
      word += c
      hasWord = true
    }
  }
  endCommand()

  return commands
}

// Words that run the command after them: `sudo sf ...`, `npx sf ...`, PowerShell's `. ./x.ps1`.
const PREFIXES = new Set(['sudo', 'npx', 'time', 'command', 'exec', 'env', 'nohup', 'xargs', '.'])

/** A program's bare name: `/usr/local/bin/sf` → `sf`, `C:\\nodejs\\sf.cmd` → `sf`. */
const programName = (word: string) =>
  (word.split(/[\\/]/).pop() ?? word).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')

/** The command line a shell wrapper runs (`bash -c '…'`, `pwsh -Command …`, `cmd /c …`), and how to read it. */
const wrapped = (words: Words): { line: string; shell: Shell } | undefined => {
  const name = programName(words[0] ?? '')
  const rest = words.slice(1)
  if (['bash', 'sh', 'zsh'].includes(name)) {
    const at = rest.findIndex(word => /^-[a-z]*c$/.test(word))
    const line = at >= 0 ? rest[at + 1] : undefined
    return line === undefined ? undefined : { line, shell: 'bash' }
  }
  if (name === 'pwsh' || name === 'powershell') {
    const at = rest.findIndex(word => /^-(c|command)$/i.test(word))
    return at < 0 ? undefined : { line: rest.slice(at + 1).join(' '), shell: 'powershell' }
  }
  if (name === 'cmd') {
    const at = rest.findIndex(word => /^\/[ck]$/i.test(word))
    return at < 0 ? undefined : { line: rest.slice(at + 1).join(' '), shell: 'powershell' }
  }

  return undefined
}

/** The words that matter: leading `FOO=bar`, prefixes and shell wrappers peeled off. */
const commandWords = (words: Words): Words => {
  let rest = words
  while (rest.length > 0) {
    const first = rest[0] as string
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first) || PREFIXES.has(first)) rest = rest.slice(1)
    else break
  }

  return rest
}

export type Operation = 'deploy' | 'delete' | 'data' | 'api' | 'apex' | 'package' | 'permset' | 'org-delete' | 'script'

export const OPERATION_LABEL: Record<Operation, string> = {
  deploy: 'metadata deploy',
  delete: 'metadata delete',
  data: 'data write (DML)',
  api: 'API call that writes',
  apex: 'anonymous Apex',
  package: 'package install',
  permset: 'permission set assignment',
  'org-delete': 'org deletion',
  script: 'project script',
}

/** A write found in a command: what it does and the org it names, if any. */
export type Write = {
  operation: Operation
  /** `-o`/`--target-org` (or the legacy `-u`); absent, the default target org. */
  target?: string
  /** The simple command it was found in, for the confirmation. */
  text: string
}

const flagValue = (words: Words, names: string[]): string | undefined => {
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string
    for (const name of names) {
      if (word === name) return words[i + 1]
      if (name.startsWith('--') && word.startsWith(`${name}=`)) return word.slice(name.length + 1)
      if (!name.startsWith('--') && word.startsWith(name) && word.length > name.length) return word.slice(name.length)
    }
  }

  return undefined
}

const TARGET_FLAGS = ['--target-org', '-o', '--targetusername', '-u']

/** What an `sf`/`sfdx` command writes, from its topic and verb; undefined when it only reads. */
const sfOperation = (args: Words): Operation | undefined => {
  const plain = args.filter(word => !word.startsWith('-'))
  const [topic, verb, object] = plain
  const isDryRun = args.includes('--dry-run')

  // sfdx legacy colon form: force:source:deploy, force:data:record:create ...
  if (topic?.includes(':')) {
    const parts = topic.split(':')
    if (parts[0] === 'force') parts.shift()
    const [t, v, w] = parts
    // `-c` is --checkonly here; in `sf project deploy start` it is --ignore-conflicts.
    const isCheckOnly = args.includes('--checkonly') || args.includes('-c')
    if ((t === 'source' || t === 'mdapi') && (v === 'deploy' || v === 'push') && !isCheckOnly) return 'deploy'
    if (t === 'source' && v === 'delete') return 'delete'
    if (t === 'data' && (v === 'record' ? w !== 'get' : v === 'bulk' || v === 'tree' && w === 'import')) return 'data'
    if (t === 'apex' && v === 'execute') return 'apex'
    if (t === 'package' && v === 'install') return 'package'
    if (t === 'user' && v === 'permset') return 'permset'
    if (t === 'org' && v === 'delete') return 'org-delete'
    return undefined
  }

  if (topic === 'project' && verb === 'deploy' && ['start', 'quick', 'resume'].includes(object ?? '') && !isDryRun) return 'deploy'
  if (topic === 'project' && verb === 'delete' && object === 'source') return 'delete'
  if (topic === 'data' && ['create', 'update', 'delete', 'upsert', 'import', 'bulk'].includes(verb ?? '')) return 'data'
  // `sf api request rest` is a GET unless told otherwise; GraphQL may carry a mutation.
  if (topic === 'api' && verb === 'request' && object === 'rest') {
    const method = flagValue(args, ['--method', '-X'])?.toUpperCase() ?? 'GET'
    return method === 'GET' || method === 'HEAD' ? undefined : 'api'
  }
  if (topic === 'api' && verb === 'request' && object === 'graphql') return 'api'
  if (topic === 'apex' && verb === 'run' && object !== 'test') return 'apex'
  if (topic === 'package' && verb === 'install') return 'package'
  if (topic === 'org' && verb === 'assign') return 'permset'
  if (topic === 'org' && verb === 'delete') return 'org-delete'

  return undefined
}

const SCRIPT_NAME = /deploy|push|release|data|seed|apex|migrate/i

/** The name of a project script a command runs (`npm run deploy:uat`, `./scripts/deploy.sh`), if any. */
const scriptName = (words: Words): string | undefined => {
  const [first, second, third] = words
  if ((first === 'npm' || first === 'pnpm') && (second === 'run' || second === 'run-script')) return third
  if (first === 'yarn') return second === 'run' ? third : second
  if (first === 'make') return second ?? 'make'
  const file = first !== undefined && ['bash', 'sh', 'zsh', 'pwsh', 'powershell'].includes(programName(first)) ? second : first
  if (file !== undefined && /\.(sh|ps1|cmd|bat)$/i.test(file)) return file.split(/[\\/]/).pop()

  return undefined
}

/** Every write a shell command would make to a Salesforce org, unwrapping `bash -c` and the like. */
export const findWrites = (line: string, shell: Shell = 'bash', depth = 0): Write[] =>
  splitCommands(line, shell).flatMap(raw => {
    const words = commandWords(raw)
    const [first] = words
    if (first === undefined) return []
    const text = raw.join(' ')
    const inner = depth < 3 ? wrapped(words) : undefined
    if (inner !== undefined) return findWrites(inner.line, inner.shell, depth + 1)
    const name = programName(first)
    if (name === 'sf' || name === 'sfdx') {
      const args = words.slice(1)
      const operation = sfOperation(args)
      return operation ? [{ operation, target: flagValue(args, TARGET_FLAGS), text }] : []
    }
    const script = scriptName(words)
    if (script !== undefined && SCRIPT_NAME.test(script)) return [{ operation: 'script' as const, text }]

    return []
  })

/** The simple commands that are not `sf`/`sfdx`, where a protected org named by hand is a write we cannot read. */
export const otherCommands = (line: string, shell: Shell = 'bash', depth = 0): string[] =>
  splitCommands(line, shell).flatMap(raw => {
    const words = commandWords(raw)
    const [first] = words
    if (first === undefined) return []
    const inner = depth < 3 ? wrapped(words) : undefined
    if (inner !== undefined) return otherCommands(inner.line, inner.shell, depth + 1)
    const name = programName(first)

    return name === 'sf' || name === 'sfdx' ? [] : [raw.join(' ')]
  })

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether a text names an org: its alias as a whole word, its username, or its instance host. */
export const mentions = (text: string, org: { username: string; alias?: string; instanceUrl?: string }) => {
  const lower = text.toLowerCase()
  if (lower.includes(org.username.toLowerCase())) return true
  const host = org.instanceUrl?.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
  if (host && lower.includes(host)) return true

  return org.alias !== undefined && new RegExp(`(^|[^\\w.-])${escape(org.alias.toLowerCase())}($|[^\\w.-])`).test(lower)
}
