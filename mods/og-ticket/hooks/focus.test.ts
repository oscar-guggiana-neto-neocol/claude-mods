import { describe, expect, test } from 'claude-code/testing'

import { focusOf, parseFocus, statusText } from './focus'

describe('parseFocus', () => {
  test('the first word is the ID when it looks like one', () => {
    expect(parseFocus('SFCOMPRG-1234 Quote sync fails on renewal')).toEqual({
      id: 'SFCOMPRG-1234',
      description: 'Quote sync fails on renewal',
    })
    expect(parseFocus('PLA-41')).toEqual({ id: 'PLA-41', description: '' })
    expect(parseFocus('STK2-7 x')).toEqual({ id: 'STK2-7', description: 'x' })
  })

  test('otherwise the whole text is the description', () => {
    expect(parseFocus('sfcomprg-1234 lower case')).toEqual({ description: 'sfcomprg-1234 lower case' })
    expect(parseFocus('Adjust the Quote layout (sheet row 14)')).toEqual({ description: 'Adjust the Quote layout (sheet row 14)' })
  })

  test('collapses whitespace; nothing is no focus', () => {
    expect(parseFocus('  PLA-41   two\n lines  ')).toEqual({ id: 'PLA-41', description: 'two lines' })
    expect(parseFocus('   ')).toBeUndefined()
  })
})

describe('focusOf', () => {
  test('an ID, a description, or both; neither is nothing', () => {
    expect(focusOf('PLA-41', ' Fix ')).toEqual({ id: 'PLA-41', description: 'Fix' })
    expect(focusOf(undefined, 'Fix')).toEqual({ description: 'Fix' })
    expect(focusOf(' ', 'Fix')).toEqual({ description: 'Fix' })
    expect(focusOf('PLA-41', undefined)).toEqual({ id: 'PLA-41', description: '' })
    expect(focusOf(undefined, '  ')).toBeUndefined()
  })
})

describe('statusText', () => {
  test('with and without an ID', () => {
    expect(statusText({ id: 'PLA-41', description: 'Fix' })).toBe('🎫 PLA-41 · Fix')
    expect(statusText({ id: 'PLA-41', description: '' })).toBe('🎫 PLA-41')
    expect(statusText({ description: 'Fix' })).toBe('🎫 Fix')
  })

  test('cut to 60 characters', () => {
    const line = statusText({ id: 'SFCOMPRG-1234', description: 'x'.repeat(100) })
    expect([...line].length).toBe(60)
    expect(line.endsWith('…')).toBe(true)
  })
})
