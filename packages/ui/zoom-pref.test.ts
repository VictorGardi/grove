import { describe, expect, it } from 'vitest'
import { DEFAULT_ZOOM, ZOOM_KEY, readZoom, stepZoom, writeZoom } from './zoom-pref.ts'

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial }
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) }
}

describe('zoom preference', () => {
  it('is 100% with nothing stored, junk, out-of-range values or no storage', () => {
    expect(DEFAULT_ZOOM).toBe(1)
    expect(readZoom(null)).toBe(1)
    expect(readZoom(memory())).toBe(1)
    expect(readZoom(memory({ [ZOOM_KEY]: 'big' }))).toBe(1)
    expect(readZoom(memory({ [ZOOM_KEY]: '0.2' }))).toBe(1)
    expect(readZoom(memory({ [ZOOM_KEY]: '4' }))).toBe(1)
  })
  it('round-trips a level', () => {
    const store = memory()
    writeZoom(store, 1.3)
    expect(readZoom(store)).toBe(1.3)
  })
  it('steps by 10% without float drift', () => {
    let level = 1
    for (let i = 0; i < 3; i++) level = stepZoom(level, 'in')
    expect(level).toBe(1.3)
    for (let i = 0; i < 6; i++) level = stepZoom(level, 'out')
    expect(level).toBe(0.7)
  })
  it('stops at 50% and 300%', () => {
    let level = 1
    for (let i = 0; i < 30; i++) level = stepZoom(level, 'out')
    expect(level).toBe(0.5)
    for (let i = 0; i < 40; i++) level = stepZoom(level, 'in')
    expect(level).toBe(3)
  })
  it('resets to 100%', () => {
    expect(stepZoom(2.4, 'reset')).toBe(1)
  })
})
