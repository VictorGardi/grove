import { describe, expect, it } from 'vitest'
import { GRID_MAX, gridCols, gridMembers, paneSpans } from './layout.ts'

describe('gridCols', () => {
  it('picks 1, 2 or 3 columns by count', () => {
    expect([0, 1, 2, 4, 5, 9].map((n) => gridCols(n))).toEqual([1, 1, 2, 2, 3, 3])
  })
})

describe('paneSpans', () => {
  it('stretches the last pane across its row', () => {
    expect(paneSpans(3).map((x) => x.cols)).toEqual([1, 1, 2])
    expect(paneSpans(5).map((x) => x.cols)).toEqual([1, 1, 1, 1, 2])
    expect(paneSpans(1).map((x) => x.cols)).toEqual([1])
  })
  it('fills full rows without a stretch', () => {
    expect(paneSpans(4).map((x) => x.cols)).toEqual([1, 1, 1, 1])
    expect(paneSpans(9).map((x) => x.cols)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1])
  })
  it('is one row per pane', () => {
    expect(paneSpans(7).every((x) => x.rows === 1)).toBe(true)
  })
  it('is empty for no panes', () => {
    expect(paneSpans(0)).toEqual([])
  })
})

describe('gridMembers', () => {
  it('keeps the order', () => {
    expect(gridMembers(['c', 'a', 'b'])).toEqual(['c', 'a', 'b'])
  })
  it('cuts at nine', () => {
    const ids = Array.from({ length: 12 }, (_, i) => 't' + i)
    expect(gridMembers(ids)).toEqual(ids.slice(0, GRID_MAX))
    expect(gridMembers(ids, 2)).toEqual(['t0', 't1'])
  })
  it('is empty for an empty list', () => {
    expect(gridMembers([])).toEqual([])
  })
  it('leaves a shorter list unchanged', () => {
    expect(gridMembers(['a', 'b'])).toEqual(['a', 'b'])
  })
})
