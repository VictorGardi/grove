import { describe, expect, it } from 'vitest'
import { gridCols, gridShown, withMember } from './gridView'

describe('gridCols', () => {
  it('picks 1, 2 or 3 columns by count', () => {
    expect([0, 1, 2, 4, 5, 9].map((n) => gridCols(n))).toEqual([1, 1, 2, 2, 3, 3])
  })
  it('is capped by maxCols', () => {
    expect(gridCols(9, 2)).toBe(2)
    expect(gridCols(4, 1)).toBe(1)
    expect(gridCols(2, 3)).toBe(2)
  })
})

describe('gridShown', () => {
  const ui = (open: boolean, members: string[], focusedSessionId: string | null) => ({ grid: { open, members }, focusedSessionId })
  it('needs the grid on, members, and a focused member', () => {
    expect(gridShown(ui(true, ['a', 'b'], 'b'))).toBe(true)
    expect(gridShown(ui(false, ['a'], 'a'))).toBe(false)
    expect(gridShown(ui(true, [], 'a'))).toBe(false)
    expect(gridShown(ui(true, ['a'], 'z'))).toBe(false)
    expect(gridShown(ui(true, ['a'], null))).toBe(false)
  })
})

describe('withMember', () => {
  it('adds a member last and removes it again', () => {
    const added = withMember({ open: false, members: ['a'] }, 'b')
    expect(added).toEqual({ open: false, members: ['a', 'b'] })
    expect(withMember(added, 'a')).toEqual({ open: false, members: ['b'] })
  })
  it('keeps open as it was', () => {
    expect(withMember({ open: true, members: ['a'] }, 'b').open).toBe(true)
  })
  it('refuses a tenth member', () => {
    const full = { open: true, members: Array.from({ length: 9 }, (_, i) => 's' + i) }
    expect(withMember(full, 'x')).toBe(full)
    expect(withMember(full, 's3').members).toHaveLength(8)
  })
  it('closes the grid when the last member leaves', () => {
    expect(withMember({ open: true, members: ['a'] }, 'a')).toEqual({ open: false, members: [] })
  })
})
