import { describe, expect, it } from 'vitest'
import type { UsageDay, UsageSummary } from '../protocol/messages.ts'
import { buildingProgress, dayTip, splitCount, totalDelta } from './usage-hover.ts'

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, credits: 0, withoutCredits: 0 }
const day = (d: string, requests: number, over: Partial<UsageDay> = {}): UsageDay => ({ day: d, requests, ...zero, helperRequests: 0, models: [], sources: [], ...over })

function summary(over: Partial<UsageSummary> = {}): UsageSummary {
  return {
    today: '2026-11-16',
    building: false,
    ready: { from: '2026-10-01', to: '2026-11-16' },
    progress: [],
    agents: [
      {
        agent: 'claude',
        hasCredits: false,
        from: '2026-10-01',
        days: [
          day('2026-11-15', 3, { models: [{ model: 'claude-haiku-4-5-20251001', requests: 1, ...zero }, { model: 'claude-opus-4-5-20251101', requests: 2, ...zero }] }),
          day('2026-11-16', 5),
        ],
        today: { requests: 5, ...zero },
        last7: { requests: 8, ...zero },
        last30: { requests: 8, ...zero },
        hours: new Array<number>(168).fill(0),
        repositories: [],
        models: [],
        sources: [],
        trackedSince: null,
      },
      {
        agent: 'copilot',
        hasCredits: true,
        from: '2026-10-01',
        days: [day('2026-11-15', 4, { credits: 2.5, models: [{ model: 'gpt-5', requests: 4, ...zero }] })],
        today: { requests: 0, ...zero },
        last7: { requests: 4, ...zero },
        last30: { requests: 4, ...zero },
        hours: new Array<number>(168).fill(0),
        repositories: [],
        models: [],
        sources: [],
        trackedSince: null,
      },
    ],
    ...over,
  }
}

describe('dayTip', () => {
  it('names the date, each agent that made requests, its top model and the Copilot credits', () => {
    const tip = dayTip(summary(), '2026-11-15')
    expect(tip.title).toBe('Sun 15 Nov 2026')
    expect(tip.lines).toEqual([
      { agent: 'claude', title: 'Claude', requests: '3 requests', top: 'claude-opus-4-5', credits: null },
      { agent: 'copilot', title: 'Copilot CLI', requests: '4 requests', top: 'gpt-5', credits: '2.50 credits' },
    ])
    expect(tip.note).toBeNull()
  })

  it('leaves out an agent with no request that day, and says so when none had', () => {
    expect(dayTip(summary(), '2026-11-16').lines.map((l) => l.agent)).toEqual(['claude'])
    expect(dayTip(summary(), '2026-11-10')).toMatchObject({ lines: [], note: 'No requests' })
  })

  it('says there is no record for a day before the files begin', () => {
    expect(dayTip(summary(), '2026-09-01')).toMatchObject({ lines: [], note: 'No record that far back' })
  })
})

describe('totalDelta', () => {
  it('compares Today with yesterday', () => {
    expect(totalDelta(summary(), 'claude', 'Today')).toBe('2 more than yesterday (3)')
  })

  it('compares 7 days with the 7 days before', () => {
    expect(totalDelta(summary(), 'copilot', '7 days')).toBe('4 fewer than the 7 days before (0)'.replace('4 fewer', '4 more'))
  })

  it('says the same when nothing changed', () => {
    const s = summary()
    s.agents[0].days = [day('2026-11-15', 5), day('2026-11-16', 5)]
    expect(totalDelta(s, 'claude', 'Today')).toBe('Same as yesterday (5)')
  })

  it('gives nothing when the period before reaches back past the record', () => {
    const from = (day: string, agent: 'claude' | 'copilot' = 'claude'): UsageSummary => {
      const s = summary()
      s.agents.find((a) => a.agent === agent)!.from = day
      return s
    }
    expect(totalDelta(from('2026-11-16'), 'claude', 'Today')).toBeNull()
    expect(totalDelta(from('2026-11-10'), 'claude', '7 days')).toBeNull()
  })

  it('goes by the agent’s own first day, not the earliest of all agents', () => {
    const s = summary()
    s.agents[0].from = '2026-11-16'
    expect(s.ready?.from).toBe('2026-10-01')
    expect(totalDelta(s, 'claude', 'Today')).toBeNull()
    expect(totalDelta(s, 'copilot', 'Today')).not.toBeNull()
  })
})

describe('buildingProgress', () => {
  it('is the mean of the agents while building, and null otherwise', () => {
    const progress = [
      { agent: 'claude' as const, fraction: 0.5 },
      { agent: 'copilot' as const, fraction: 1 },
    ]
    expect(buildingProgress(summary({ building: true, progress }))).toBe(0.75)
    expect(buildingProgress(summary({ building: false, progress }))).toBeNull()
    expect(buildingProgress(summary({ building: true, progress: [] }))).toBeNull()
  })
})

describe('splitCount', () => {
  it('separates the number from its words', () => {
    expect(splitCount('1,234 requests')).toEqual({ count: 1234, rest: ' requests' })
    expect(splitCount('1 request')).toEqual({ count: 1, rest: ' request' })
    expect(splitCount('No record that far back')).toBeNull()
  })
})
