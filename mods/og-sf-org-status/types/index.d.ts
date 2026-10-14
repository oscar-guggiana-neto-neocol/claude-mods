export type OrgKind = 'production' | 'sandbox' | 'scratch' | 'developer' | 'unknown'

/** The org the sf CLI targets from the session's directory. */
export type TargetOrg = {
  /** What the config named: an alias or a username. */
  target: string
  alias?: string
  username: string
  kind: OrgKind
  instanceUrl?: string
  /** Where the target came from, in the sf CLI's precedence order. */
  source: 'env' | 'project' | 'global'
}

/** One authenticated org, from its auth file in ~/.sfdx. */
export type OrgRow = {
  username: string
  /** The alias shown: the first one pointing at this username. */
  alias?: string
  kind: OrgKind
  instanceUrl?: string
  /** The company domain the username belongs to (`globex.com`), when known. */
  domain?: string
}

export type OrgInfo =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ok'
      orgId?: string
      apiVersion?: string
      connectedStatus?: string
      edition?: string
      pod?: string
      expires?: string
    }

/** What the panel shows for the project the session is in. */
export type Panel = {
  root: string
  name: string
  /** The project's orgs: saved for this project, else inferred by domain. */
  orgs: OrgRow[]
  listSource: 'saved' | 'inferred'
  /** Every authenticated org, for editing the list. */
  catalog: OrgRow[]
}

declare module 'claude-code' {
  interface PluginState {
    'og-sf-org-status': {
      current: TargetOrg | null
      panel: Panel | null
      /** The username highlighted in the panel. */
      selected: string | null
      /** Usernames checked while editing the list; null when not editing. */
      editing: string[] | null
      info: Record<string, OrgInfo>
      message: string | null
      /** The production username whose warning band was dismissed. */
      bandDismissed: string | null
    }
  }
}
