export type BlockKind = 'code' | 'table' | 'heading' | 'item' | 'paragraph'

/** One part of a response that can be copied on its own. */
export type Block = {
  kind: BlockKind
  /** Its Markdown, as Claude wrote it. */
  text: string
}

/** What the pane shows: one response and the blocks checked in it. */
export type View = {
  /** Claude's responses, newest first, each the text of one turn. */
  responses: string[]
  /** Which response is shown: 0 is the newest. */
  index: number
  /** The checked blocks' positions in the shown response. */
  checked: number[]
}

declare module 'claude-code' {
  interface PluginState {
    'og-copy': {
      view: View | null
    }
  }
}
