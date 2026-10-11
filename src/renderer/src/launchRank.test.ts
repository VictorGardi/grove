import { describe, expect, it } from 'vitest'
import { score } from './launchRank'

describe('score', () => {
  it('matches an empty query against anything, so the unfiltered list is everything', () => {
    expect(score('', 'anything at all')).toBe(0)
  })

  it('matches a subsequence, which is how half-remembered branch names are typed', () => {
    expect(score('fhl', 'fix-header-layout')).not.toBeNull()
    expect(score('gro', 'grove')).not.toBeNull()
    expect(score('a', 'spatial-intelligence-platform')).not.toBeNull()
  })

  it('rejects text that cannot hold the query in order', () => {
    expect(score('lg', 'grove')).toBeNull()
    expect(score('zzz', 'grove')).toBeNull()
  })

  // The ordering the picker depends on: a prefix must outrank a scattered match, or typing
  // "gro" surfaces every branch containing g-r-o over grove itself.
  it('ranks a prefix above a scattered match', () => {
    expect(score('gro', 'grove')).toBeGreaterThan(score('gro', 'payload-groove') ?? 0)
  })

  it('ranks an exact hit above a prefix', () => {
    expect(score('main', 'main')).toBeGreaterThan(score('main', 'mainline') ?? 0)
  })

  it('prefers characters that run together', () => {
    expect(score('head', 'fix-header-layout')).toBeGreaterThan(score('head', 'harness-expose-api-deadline') ?? 0)
  })

  it('is case insensitive, because branches are typed in whatever case comes to hand', () => {
    expect(score('GROVE', 'grove')).toBe(score('grove', 'grove'))
  })

  // A single character matches nearly everything, so ordering has to come from the prefix bonus
  // rather than from the raw subsequence score.
  it('still orders two rows when the query is one character', () => {
    expect(score('g', 'grove')).toBeGreaterThan(score('g', 'payments') ?? 0)
  })
})