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

describe('pruneGrid spans and tracks', () => {
  it('drops the spans of sessions that are no longer members', () => {
    const g = pruneGrid({ open: true, members: ['a', 'x'], spans: { a: 'wide', x: 'tall' } }, (id) => id !== 'x')
    expect(g).toEqual({ open: true, members: ['a'], spans: { a: 'wide' } })
  })
  it('leaves no empty spans behind', () => {
    expect(pruneGrid({ open: true, members: ['a', 'x'], spans: { x: 'tall' } }, (id) => id !== 'x')).toEqual({ open: true, members: ['a'] })
  })
  it('keeps track sizes', () => {
    const tracks = { '2x2': { cols: [0.3, 0.7] } }
    expect(pruneGrid({ open: true, members: ['a', 'x'], tracks }, (id) => id !== 'x').tracks).toBe(tracks)
  })
  it('returns the same object when spans are all members', () => {
    const g = { open: true, members: ['a'], spans: { a: 'wide' as const } }
    expect(pruneGrid(g, all)).toBe(g)
  })
})
