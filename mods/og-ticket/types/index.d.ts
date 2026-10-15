/** The work item in focus: an optional ID and what it is about. */
export type Focus = {
  /** A tracker key such as `SFCOMPRG-1234`, when the item has one. */
  id?: string
  /** Empty only when there is an ID. */
  description: string
}

declare module 'claude-code' {
  interface PluginState {
    'og-ticket': {
      /** The focus as the hint line draws it; null when there is none. */
      line: string | null
    }
  }
}
