import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { contextView, formatPct, formatTokens, formatUsage, gaugeFill } from './contextGauge'

const session = (over: Partial<Session> = {}): Session => ({
  id: 'a', projectId: 'p', kind: 'claude', label: 'a', labelPinned: false, tmuxName: 'grove-a',
  cwd: null, agentSessionId: 'u', feature: null, linkPinned: false, action: null,
  startedAt: '2026-10-05T10:00:00.000Z', endedAt: null, lastStatus: 'running', seenAt: null, lastContext: null, workflowStatus: 'in-progress', ...over,
})

describe('contextView', () => {
  it('shows the live reading of a running Claude session', () => {
    expect(contextView(session({ contextPct: 19, contextTokens: 190300, contextWindow: 1000000 })))
      .toEqual({ pct: 19, tokens: 190300, window: 1000000, dim: false })
  })

  it('is empty (pct null) while running without a reading, and after /compact', () => {
    expect(contextView(session())).toEqual({ pct: null, tokens: null, window: null, dim: false })
    expect(contextView(session({ contextPct: null, contextTokens: null, contextWindow: 200000, lastContext: { pct: 50, tokens: 1, window: 2 } })))
      .toEqual({ pct: null, tokens: null, window: 200000, dim: false })
  })

  it('dims the last known reading of an ended session, or shows nothing', () => {
    expect(contextView(session({ lastStatus: 'gone', lastContext: { pct: 40, tokens: 80000, window: 200000 } })))
      .toEqual({ pct: 40, tokens: 80000, window: 200000, dim: true })
    expect(contextView(session({ lastStatus: 'gone' }))).toBeNull()
  })

  it('never shows a gauge for terminals or OpenCode', () => {
    expect(contextView(session({ kind: 'terminal' }))).toBeNull()
    expect(contextView(session({ kind: 'opencode' }))).toBeNull()
  })
})

describe('gaugeFill', () => {
  it('maps a percentage to 0..1, clamped; unknown is empty', () => {
    expect(gaugeFill(0)).toBe(0)
    expect(gaugeFill(25)).toBe(0.25)
    expect(gaugeFill(100)).toBe(1)
    expect(gaugeFill(130)).toBe(1)
    expect(gaugeFill(-5)).toBe(0)
    expect(gaugeFill(null)).toBe(0)
    expect(gaugeFill(NaN)).toBe(0)
  })
})

describe('formatTokens', () => {
  it.each([
    [0, '0'], [950, '950'], [1000, '1.0k'], [12345, '12.3k'], [190300, '190.3k'], [999949, '999.9k'], [999950, '1.0M'],
    [1000000, '1.0M'], [1250000, '1.3M'], [200000, '200.0k'],
  ])('%i → %s', (n, out) => expect(formatTokens(n)).toBe(out))
})

describe('formatPct and formatUsage', () => {
  it('shows — for an unknown percentage', () => {
    expect(formatPct(null)).toBe('—')
    expect(formatPct(19)).toBe('19%')
    expect(formatPct(19.6)).toBe('20%')
  })

  it('formats tokens over the window, if the window is known', () => {
    expect(formatUsage(190300, 1000000)).toBe('190.3k / 1.0M')
    expect(formatUsage(null, 200000)).toBe('— / 200.0k')
    expect(formatUsage(5, null)).toBeNull()
  })
})
