// Pure logic: the one line a tool call is drawn as in focus mode.

type Input = Record<string, unknown>
type Patch = { lines?: unknown }[]

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

const firstLine = (value: string) => value.trim().split('\n')[0] ?? ''

/** A path relative to the session's directory when it lies under it. */
export const shortPath = (path: string, cwd: string | undefined) =>
  cwd !== undefined && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path

const host = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const lineCount = (value: string | undefined) => (value === undefined || value === '' ? 0 : value.split('\n').length)

/** Added and removed lines: from the result's patch once done, else from the input. */
export const changeCounts = (tool: string, input: Input, output: unknown) => {
  const patch = (output as { structuredPatch?: Patch } | undefined)?.structuredPatch
  if (Array.isArray(patch)) {
    let added = 0
    let removed = 0
    for (const hunk of patch) {
      for (const line of Array.isArray(hunk.lines) ? hunk.lines : []) {
        if (typeof line !== 'string') continue
        if (line.startsWith('+')) added += 1
        else if (line.startsWith('-')) removed += 1
      }
    }
    return { added, removed }
  }
  if (tool === 'Write') return { added: lineCount(text(input.content)), removed: 0 }
  if (tool === 'Edit') return { added: lineCount(text(input.new_string)), removed: lineCount(text(input.old_string)) }
  return undefined
}

/** What a call is about, in a few words: its command, file, pattern or query. */
export const subject = (tool: string, input: Input, cwd?: string): string => {
  const path = text(input.file_path) ?? text(input.notebook_path) ?? text(input.path)
  switch (tool) {
    case 'Bash':
      return firstLine(text(input.command) ?? '')
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return path === undefined ? '' : shortPath(path, cwd)
    case 'Grep':
    case 'Glob':
      return [text(input.pattern), path && `em ${shortPath(path, cwd)}`].filter(Boolean).join(' ')
    case 'WebFetch':
      return host(text(input.url) ?? '')
    case 'WebSearch':
      return text(input.query) ?? ''
    case 'Agent':
    case 'Task':
      return text(input.description) ?? ''
    case 'Skill':
      return text(input.skill) ?? ''
    default:
      return text(input.description) ?? ''
  }
}

/** `mcp__jira__jira_get_issue` → `jira · jira_get_issue`. */
export const toolLabel = (tool: string) => {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  return mcp ? `${mcp[1]} · ${mcp[2]}` : tool
}

export type CompactLine = { label: string; subject: string; counts?: string }

export const compactLine = (tool: string, input: unknown, output: unknown, cwd?: string): CompactLine => {
  const fields = input !== null && typeof input === 'object' ? (input as Input) : {}
  const counts = tool === 'Edit' || tool === 'Write' ? changeCounts(tool, fields, output) : undefined

  return {
    label: toolLabel(tool),
    subject: subject(tool, fields, cwd),
    counts: counts && `+${counts.added} −${counts.removed}`,
  }
}
