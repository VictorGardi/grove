import { describe, expect, it } from 'vitest'
import { canJoinGrid, GRID_MAX, gridCols, gridMembers } from './layout.ts'

describe('gridCols', () => {
  it('picks 1, 2 or 3 columns by count', () => {
    expect([0, 1, 2, 4, 5, 9].map((n) => gridCols(n))).toEqual([1, 1, 2, 2, 3, 3])
  })
})

describe('gridMembers', () => {
  const tab = (id: string, inGrid: boolean) => ({ id, inGrid })

  it('shows the tabs the human put in the grid, in tab order', () => {
    const tabs = [tab('a', false), tab('b', true), tab('c', false), tab('d', true)]
    expect(gridMembers(tabs).map((t) => t.id)).toEqual(['b', 'd'])
  })
  it('is empty when no tab is in the grid', () => {
    expect(gridMembers([tab('a', false)])).toEqual([])
    expect(gridMembers([])).toEqual([])
  })
  it('cuts at nine, as a guard: the window does not let a tenth in', () => {
    const tabs = Array.from({ length: 12 }, (_, i) => tab('t' + i, true))
    expect(gridMembers(tabs).map((t) => t.id)).toEqual(tabs.slice(0, GRID_MAX).map((t) => t.id))
    expect(gridMembers(tabs, 2).map((t) => t.id)).toEqual(['t0', 't1'])
  })
})

describe('canJoinGrid', () => {
  it('lets a tab in while the grid holds fewer than nine, and not a tenth', () => {
    expect(canJoinGrid(0)).toBe(true)
    expect(canJoinGrid(GRID_MAX - 1)).toBe(true)
    expect(canJoinGrid(GRID_MAX)).toBe(false)
    expect(canJoinGrid(1, 1)).toBe(false)
  })
})
