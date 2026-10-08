import { describe, expect, it } from 'vitest'
import { pruneGrid } from './grid'

const all = () => true

describe('pruneGrid', () => {
  it('drops unknown ids', () => {
    expect(pruneGrid({ open: true, members: ['a', 'x', 'b'] }, (id) => id !== 'x')).toEqual({ open: true, members: ['a', 'b'] })
  })
  it('de-duplicates', () => {
    expect(pruneGrid({ open: false, members: ['a', 'a', 'b'] }, all).members).toEqual(['a', 'b'])
  })
  it('caps at nine', () => {
    const members = Array.from({ length: 12 }, (_, i) => 's' + i)
    expect(pruneGrid({ open: true, members }, all).members).toEqual(members.slice(0, 9))
  })
  it('closes when no members are left', () => {
    expect(pruneGrid({ open: true, members: ['x'] }, () => false)).toEqual({ open: false, members: [] })
  })
  it('returns the same object when nothing changes', () => {
    const g = { open: true, members: ['a'] }
    expect(pruneGrid(g, all)).toBe(g)
  })
})
