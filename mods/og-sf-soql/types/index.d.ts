/** A query result as the pane shows it: flat rows of text, one column per field path. */
export type QueryResult = {
  query: string
  /** The org named with -o, when one was. */
  org?: string
  isTooling: boolean
  /** The object queried (`Account`), from the FROM clause. */
  object?: string
  columns: string[]
  rows: Record<string, string>[]
  /** What the org reported, which may exceed the rows returned. */
  totalSize: number
}

/** What the pane shows: the last result, and the record open in it. */
export type View = {
  result: QueryResult
  /** The row shown vertically; null for the table. */
  record: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'og-sf-soql': {
      view: View | null
    }
  }
}
