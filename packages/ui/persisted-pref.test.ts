import { describe, expect, it, vi } from 'vitest'
import { flagPref, persistedPref, type KeyValueStore } from './persisted-pref.ts'

function memory(): KeyValueStore & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  }
}

const broken: KeyValueStore = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

const evenNumber = (onFailure?: (action: 'read' | 'write', error: unknown) => void) =>
  persistedPref<number>({
    key: 'k',
    fallback: () => 7,
    decode: (text) => (Number(text) % 2 === 0 ? Number(text) : undefined),
    encode: String,
    onFailure,
  })

describe('a persisted preference', () => {
  it('reads what was written, under its key', () => {
    const store = memory()
    const pref = evenNumber()
    pref.write(store, 4)
    expect(store.values.get('k')).toBe('4')
    expect(pref.read(store)).toBe(4)
  })

  it('reads the default when nothing is stored or the text is not a valid value', () => {
    const store = memory()
    expect(evenNumber().read(store)).toBe(7)
    store.values.set('k', '3')
    expect(evenNumber().read(store)).toBe(7)
  })

  it('gives a fresh default each time', () => {
    const pref = persistedPref<{ n: number }>({ key: 'k', fallback: () => ({ n: 0 }), decode: () => undefined, encode: JSON.stringify })
    expect(pref.read(memory())).not.toBe(pref.read(memory()))
  })

  it('reads the default and keeps nothing when storage is missing or throws, without telling anyone by default', () => {
    const pref = evenNumber()
    expect(pref.read(null)).toBe(7)
    expect(pref.read(broken)).toBe(7)
    expect(() => pref.write(broken, 4)).not.toThrow()
    expect(() => pref.write(null, 4)).not.toThrow()
  })

  it('tells the failure hook when reading or writing fails, and falls back to the default', () => {
    const onFailure = vi.fn()
    const pref = persistedPref<number>({
      key: 'k',
      fallback: () => 7,
      decode: () => {
        throw new Error('bad text')
      },
      encode: String,
      onFailure,
    })
    const store = memory()
    store.values.set('k', 'x')
    expect(pref.read(store)).toBe(7)
    expect(onFailure).toHaveBeenCalledWith('read', expect.any(Error))
    pref.write(broken, 1)
    expect(onFailure).toHaveBeenCalledWith('write', expect.any(Error))
  })

  it('keeps a switch as two words, reading anything else as off', () => {
    const store = memory()
    const pref = flagPref('f', 'on', 'off')
    pref.write(store, true)
    expect(store.values.get('f')).toBe('on')
    expect(pref.read(store)).toBe(true)
    pref.write(store, false)
    expect(store.values.get('f')).toBe('off')
    store.values.set('f', 'x')
    expect(pref.read(store)).toBe(false)
  })
})
