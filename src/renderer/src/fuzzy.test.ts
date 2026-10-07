import { describe, expect, it } from 'vitest'
import { fuzzy } from './fuzzy'

const score = (q: string, t: string) => fuzzy(q, t)?.score ?? -Infinity

describe('fuzzy', () => {
  it('is null when the query is not a subsequence', () => {
    expect(fuzzy('xyz', 'abc')).toBeNull()
    expect(fuzzy('ba', 'ab')).toBeNull()
  })
  it('is case-insensitive and reports matched positions', () => {
    expect(fuzzy('GRD', 'Session grid')?.indices).toEqual([8, 9, 11])
  })
  it('matches everything with score 0 for an empty query', () => {
    expect(fuzzy('', 'anything')).toEqual({ score: 0, indices: [] })
  })
  it('prefers a prefix to a mid-word match', () => {
    expect(score('ses', 'session')).toBeGreaterThan(score('ses', 'obsessed'))
  })
  it('prefers a word boundary to a mid-word match', () => {
    expect(score('g', 'new grid')).toBeGreaterThan(score('g', 'engine'))
  })
  it('prefers a consecutive run to scattered letters', () => {
    expect(score('grid', 'a grid view')).toBeGreaterThan(score('grid', 'gxrxixd'))
  })
})
