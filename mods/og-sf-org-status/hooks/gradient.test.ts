import { describe, expect, test } from 'claude-code/testing'

import { barCells, gradient } from './gradient'

describe('gradient', () => {
  test('runs evenly through the stops, ends included', () => {
    expect(gradient(['#000000', '#ffffff'], 3)).toEqual(['#000000', '#808080', '#ffffff'])
    expect(gradient(['#00a6a5', '#3d7986', '#372554'], 5)[2]).toBe('#3d7986')
  })

  test('a bar is as wide as asked, its label bold inside the line', () => {
    const cells = barCells(30, 'free', 'og-sf-org-status')
    expect(cells).toHaveLength(30)
    expect(cells.map(cell => cell.char).join('')).toBe('━━ og-sf-org-status ━━━━━━━━━━')
    expect(cells.filter(cell => cell.isBold).map(cell => cell.char).join('')).toBe(' og-sf-org-status ')
    expect(barCells(10, 'production').every(cell => cell.char === '━')).toBe(true)
  })
})
