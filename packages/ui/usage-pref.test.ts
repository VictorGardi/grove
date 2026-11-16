import { describe, expect, it } from 'vitest'
import { USAGE_BREAKDOWN_KEY, USAGE_RANGE_KEY, readUsageBreakdown, readUsageRange, writeUsageBreakdown, writeUsageRange } from './usage-pref.ts'

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial }
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) }
}

describe('the usage panel’s kept choices', () => {
  it('are the defaults with nothing stored, junk or no storage', () => {
    for (const store of [null, memory(), memory({ [USAGE_RANGE_KEY]: 'forever', [USAGE_BREAKDOWN_KEY]: 'x' })]) {
      expect(readUsageRange(store)).toBe('30d')
      expect(readUsageBreakdown(store)).toBe('repositories')
    }
  })

  it('round-trip a range and a breakdown', () => {
    const store = memory()
    for (const range of ['30d', '18w', '1y'] as const) {
      writeUsageRange(store, range)
      expect(readUsageRange(store)).toBe(range)
    }
    writeUsageBreakdown(store, 'models')
    expect(readUsageBreakdown(store)).toBe('models')
  })

  it('keep working when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readUsageRange(broken)).toBe('30d')
    expect(() => writeUsageRange(broken, '1y')).not.toThrow()
  })
})
