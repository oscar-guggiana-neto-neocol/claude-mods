import { describe, expect, test } from 'claude-code/testing'

import { joinBlocks, previewOf, splitBlocks } from './blocks'

const RESPONSE = [
  '## Result',
  '',
  'The guard now asks only on writes.',
  'Reads pass.',
  '',
  '- **Commands naming the org.** Only HTTP writes',
  '  and interpreters ask now.',
  '  - nested detail',
  '- **Anonymous Apex.** Read-only code passes.',
  '',
  '| Command | Does |',
  '| --- | --- |',
  '| `/og-ticket` | Shows the focus |',
  '',
  '```ts',
  'const a = 1',
  '',
  'const b = 2',
  '```',
  '',
  '1. First step',
  '2. Second step',
].join('\n')

describe('splitBlocks', () => {
  test('headings, paragraphs, list items with their children, tables and code, in order', () => {
    const blocks = splitBlocks(RESPONSE)
    expect(blocks.map(block => block.kind)).toEqual(['heading', 'paragraph', 'item', 'item', 'table', 'code', 'item', 'item'])
    expect(blocks[1]?.text).toBe('The guard now asks only on writes.\nReads pass.')
    expect(blocks[2]?.text).toBe('- **Commands naming the org.** Only HTTP writes\n  and interpreters ask now.\n  - nested detail')
    expect(blocks[4]?.text).toBe('| Command | Does |\n| --- | --- |\n| `/og-ticket` | Shows the focus |')
    expect(blocks[5]?.text).toBe('```ts\nconst a = 1\n\nconst b = 2\n```')
    expect(blocks[6]?.text).toBe('1. First step')
  })

  test('an unclosed fence runs to the end; empty text has no blocks', () => {
    expect(splitBlocks('Intro\n```\ncode')).toEqual([
      { kind: 'paragraph', text: 'Intro' },
      { kind: 'code', text: '```\ncode' },
    ])
    expect(splitBlocks('  \n\n')).toEqual([])
  })

  test('a paragraph right before a list or a table ends there', () => {
    expect(splitBlocks('Options:\n- a\n- b').map(block => block.kind)).toEqual(['paragraph', 'item', 'item'])
    expect(splitBlocks('See:\n| a |\n| - |').map(block => block.kind)).toEqual(['paragraph', 'table'])
  })
})

describe('joinBlocks', () => {
  test('a blank line between blocks; consecutive list items stay a list', () => {
    const blocks = splitBlocks(RESPONSE)
    expect(joinBlocks([blocks[0], blocks[1]].filter(b => b !== undefined))).toBe(
      '## Result\n\nThe guard now asks only on writes.\nReads pass.',
    )
    expect(joinBlocks([blocks[6], blocks[7]].filter(b => b !== undefined))).toBe('1. First step\n2. Second step')
  })
})

describe('previewOf', () => {
  test('the first line, cut, and how many lines there are', () => {
    const blocks = splitBlocks(RESPONSE)
    expect(previewOf(blocks[4] ?? { kind: 'table', text: '' }, 80)).toEqual({ line: '| Command | Does |', more: '3 lines' })
    expect(previewOf({ kind: 'paragraph', text: 'x'.repeat(100) }, 20)).toEqual({ line: `${'x'.repeat(19)}…`, more: undefined })
    expect(previewOf({ kind: 'code', text: '```ts\nconst a = 1\n```' }, 80)).toEqual({ line: '```ts const a = 1', more: '3 lines' })
  })
})
