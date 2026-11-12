import { describe, expect, it } from 'vitest'
import { contextLevel } from './context-level.ts'
import type { ContextUsage } from './messages.ts'

const usage = (tokens: number | null, window: number | null, percent: number | null = null): ContextUsage => ({ tokens, window, percent, model: 'opus', at: 0 })

describe('contextLevel', () => {
  it('has no level without a reading or without tokens', () => {
    expect(contextLevel(undefined)).toBeNull()
    expect(contextLevel(usage(null, 200_000))).toBeNull()
    expect(contextLevel(usage(0, 200_000))).toBeNull()
  })

  it('warns from 150k tokens or half the window, and hands off from 200k or 70%, whichever comes first', () => {
    expect(contextLevel(usage(99_000, 200_000))).toBe('ok')
    expect(contextLevel(usage(100_000, 200_000))).toBe('warn')
    expect(contextLevel(usage(139_000, 200_000))).toBe('warn')
    expect(contextLevel(usage(140_000, 200_000))).toBe('handoff')
    expect(contextLevel(usage(149_000, 1_000_000))).toBe('ok')
    expect(contextLevel(usage(150_000, 1_000_000))).toBe('warn')
    expect(contextLevel(usage(199_000, 1_000_000))).toBe('warn')
    expect(contextLevel(usage(200_000, 1_000_000))).toBe('handoff')
  })

  it('judges a small window by its share, so a 100k window warns at 50k', () => {
    expect(contextLevel(usage(49_000, 100_000))).toBe('ok')
    expect(contextLevel(usage(50_000, 100_000))).toBe('warn')
    expect(contextLevel(usage(70_000, 100_000))).toBe('handoff')
  })

  it('judges a reading with no window by its tokens alone', () => {
    expect(contextLevel(usage(149_000, null))).toBe('ok')
    expect(contextLevel(usage(150_000, null))).toBe('warn')
    expect(contextLevel(usage(200_000, null))).toBe('handoff')
  })

  it('prefers the provider percent over one worked out from the window', () => {
    expect(contextLevel(usage(60_000, 200_000, 75))).toBe('handoff')
  })
})
