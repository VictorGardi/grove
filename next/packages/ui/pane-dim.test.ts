import { describe, expect, it } from 'vitest'
import { PANE_DIM_KEY, clampPaneDim, readPaneDim, writePaneDim } from './pane-dim.ts'

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial }
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) }
}

describe('pane dim', () => {
  it('clamps to the range', () => {
    expect(clampPaneDim(0)).toBe(0.1)
    expect(clampPaneDim(2)).toBe(1)
    expect(clampPaneDim(0.5)).toBe(0.5)
  })
  it('reads null when nothing, junk or no storage', () => {
    expect(readPaneDim(null)).toBeNull()
    expect(readPaneDim(memory())).toBeNull()
    expect(readPaneDim(memory({ [PANE_DIM_KEY]: 'x' }))).toBeNull()
  })
  it('round-trips a choice', () => {
    const store = memory()
    writePaneDim(store, 0.45)
    expect(readPaneDim(store)).toBe(0.45)
  })
})
