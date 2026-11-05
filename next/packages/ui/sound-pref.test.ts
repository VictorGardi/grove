import { describe, expect, it } from 'vitest'
import { SOUND_KEY, readSound, writeSound } from './sound-pref.ts'

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial }
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) }
}

describe('sound preference', () => {
  it('is off with nothing stored, junk or no storage', () => {
    expect(readSound(null)).toBe(false)
    expect(readSound(memory())).toBe(false)
    expect(readSound(memory({ [SOUND_KEY]: 'x' }))).toBe(false)
  })
  it('round-trips a choice', () => {
    const store = memory()
    writeSound(store, true)
    expect(readSound(store)).toBe(true)
    writeSound(store, false)
    expect(readSound(store)).toBe(false)
  })
})
