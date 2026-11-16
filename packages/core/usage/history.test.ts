import { describe, expect, it } from 'vitest'
import { dayKey } from '../../protocol/days.ts'
import { CLAUDE_CODE, UsageHistory, type UsageRequest } from './history.ts'
import { UsageIndex } from './index.ts'

const day = (d: number, hour = 10) => new Date(2026, 10, d, hour).getTime()

const request = (key: string, at: number, extra: Partial<UsageRequest> = {}): UsageRequest => ({
  key,
  agent: 'claude',
  source: CLAUDE_CODE,
  model: 'claude-opus',
  folder: '/work/app',
  at,
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  helper: false,
  nanoAiu: null,
  inGrove: null,
  ...extra,
})

function tracked(): { history: UsageHistory; index: UsageIndex } {
  const history = new UsageHistory()
  const index = new UsageIndex()
  history.observer = (before, after) => index.apply(before, after)
  return { history, index }
}

// What the span should be, by looking at every request.
const looked = (history: UsageHistory): { from: string; to: string } | null => {
  const times = [...history.requests()].map((r) => r.at)
  return times.length === 0 ? null : { from: dayKey(Math.min(...times)), to: dayKey(Math.max(...times)) }
}

describe('the earliest and latest day the usage index tracks', () => {
  it('is null for an empty history', () => {
    expect(tracked().index.span()).toBeNull()
  })

  it('follows requests as they arrive in any order', () => {
    const { history, index } = tracked()
    history.add(request('a', day(10)))
    expect(index.span()).toEqual({ from: '2026-11-10', to: '2026-11-10' })
    history.add(request('b', day(14)))
    history.add(request('c', day(3)))
    history.add(request('d', day(8)))
    expect(index.span()).toEqual({ from: '2026-11-03', to: '2026-11-14' })
  })

  it('spans every agent', () => {
    const { history, index } = tracked()
    history.add(request('a', day(10)))
    history.add(request('a', day(2), { agent: 'copilot', source: 'copilot' }))
    expect(index.span()).toEqual({ from: '2026-11-02', to: '2026-11-10' })
  })

  it('moves to the earlier day when a merge moves a request back (the earliest time wins)', () => {
    const { history, index } = tracked()
    history.add(request('a', day(14)))
    // The same request again, copied by a resumed session under an older time.
    history.add(request('a', day(5)))
    expect(history.size).toBe(1)
    expect(index.span()).toEqual({ from: '2026-11-05', to: '2026-11-05' })
  })

  it('drops the latest day when the only request on it moves earlier', () => {
    const { history, index } = tracked()
    history.add(request('a', day(14)))
    history.add(request('b', day(9)))
    history.add(request('a', day(6)))
    expect(index.span()).toEqual({ from: '2026-11-06', to: '2026-11-09' })
    expect(index.span()).toEqual(looked(history))
  })

  it('keeps the span when a request is replaced on the same day by a larger one', () => {
    const { history, index } = tracked()
    history.add(request('a', day(10), { output: 5 }))
    history.add(request('b', day(12)))
    history.add(request('a', day(10, 11), { output: 50 }))
    expect(history.size).toBe(2)
    expect(index.span()).toEqual({ from: '2026-11-10', to: '2026-11-12' })
  })

  it('ignores a later copy of a request the history already holds', () => {
    const { history, index } = tracked()
    history.add(request('a', day(10)))
    expect(history.add(request('a', day(20)))).toBe(false)
    expect(index.span()).toEqual({ from: '2026-11-10', to: '2026-11-10' })
  })

  it('always equals what a look at every request finds', () => {
    const { history, index } = tracked()
    let seed = 7
    const next = () => (seed = (seed * 48271) % 2147483647)
    for (let i = 0; i < 300; i++) {
      history.add(request(`k${next() % 40}`, day(1 + (next() % 28), next() % 24), { output: next() % 20, agent: next() % 3 === 0 ? 'copilot' : 'claude' }))
      expect(index.span()).toEqual(looked(history))
    }
  })
})

describe('the history keys requests per agent', () => {
  it('keeps the same key under two agents apart', () => {
    const history = new UsageHistory()
    history.add(request('same', day(10)))
    history.add(request('same', day(10), { agent: 'copilot', source: 'copilot' }))
    expect(history.size).toBe(2)
  })
})
