// Pure logic: a response's Markdown split into blocks that can be copied on
// their own, and joined back. No `$` here, so tests drive it alone.

import type { Block, BlockKind } from '../types'

const FENCE = /^\s*(`{3,}|~{3,})/
const TABLE = /^\s*\|/
const HEADING = /^#{1,6}\s/
// A list item at the top level: up to three spaces before its marker.
const ITEM = /^ {0,3}([-*+]|\d+[.)])\s+/

const isBlank = (line: string) => line.trim() === ''
const startsBlock = (line: string) => FENCE.test(line) || TABLE.test(line) || HEADING.test(line) || ITEM.test(line)

export const splitBlocks = (text: string): Block[] => {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  const push = (kind: BlockKind, from: number, to: number) => blocks.push({ kind, text: lines.slice(from, to).join('\n').trimEnd() })
  let i = 0

  while (i < lines.length) {
    const line = lines[i] as string
    const start = i
    if (isBlank(line)) {
      i++
    } else if (FENCE.test(line)) {
      const fence = (FENCE.exec(line)?.[1] ?? '```').slice(0, 3)
      i++
      while (i < lines.length && !(lines[i] as string).trim().startsWith(fence)) i++
      i = Math.min(i + 1, lines.length)
      push('code', start, i)
    } else if (TABLE.test(line)) {
      while (i < lines.length && TABLE.test(lines[i] as string)) i++
      push('table', start, i)
    } else if (HEADING.test(line)) {
      i++
      push('heading', start, i)
    } else if (ITEM.test(line)) {
      i++
      while (i < lines.length) {
        const next = lines[i] as string
        if (isBlank(next)) {
          // A blank line inside an item only when what follows is indented under it.
          const after = lines.slice(i + 1).find(one => !isBlank(one))
          if (after === undefined || !/^\s/.test(after)) break
          i++
        } else if (/^\s/.test(next) || !startsBlock(next)) {
          i++
        } else {
          break
        }
      }
      push('item', start, i)
    } else {
      i++
      while (i < lines.length && !isBlank(lines[i] as string) && !startsBlock(lines[i] as string)) i++
      push('paragraph', start, i)
    }
  }

  return blocks
}

/** The blocks' Markdown, a blank line between them; list items that follow each other stay one list. */
export const joinBlocks = (blocks: readonly Block[]) =>
  blocks.reduce((text, block, i) => {
    if (i === 0) return block.text
    const sameList = block.kind === 'item' && blocks[i - 1]?.kind === 'item'
    return `${text}${sameList ? '\n' : '\n\n'}${block.text}`
  }, '')

/** A block as one row: its first line (a code block's fence and first line), cut to `width`, and its size. */
export const previewOf = (block: Block, width: number) => {
  const lines = block.text.split('\n')
  const first = block.kind === 'code' ? lines.slice(0, 2).join(' ') : (lines[0] ?? '')
  const chars = [...first.trim()]
  const line = chars.length <= width ? chars.join('') : `${chars.slice(0, width - 1).join('')}…`

  return { line, more: lines.length > 1 ? `${lines.length} lines` : undefined }
}
