import { describe, expect, it } from 'vitest'
import { readSidebarHidden, SIDEBAR_HIDDEN_KEY, writeSidebarHidden, type KeyValueStore } from './sidebar-state.ts'

function memory(): KeyValueStore & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  }
}

describe('sidebar state', () => {
  it('shows the sidebar when nothing is stored', () => {
    expect(readSidebarHidden(memory())).toBe(false)
  })

  it('keeps a hidden sidebar across a reload, and a shown one', () => {
    const store = memory()
    writeSidebarHidden(store, true)
    expect(store.values.get(SIDEBAR_HIDDEN_KEY)).toBe('1')
    expect(readSidebarHidden(store)).toBe(true)
    writeSidebarHidden(store, false)
    expect(readSidebarHidden(store)).toBe(false)
  })

  it('shows the sidebar and keeps nothing when storage is missing or throws', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(readSidebarHidden(null)).toBe(false)
    expect(readSidebarHidden(broken)).toBe(false)
    expect(() => writeSidebarHidden(broken, true)).not.toThrow()
    expect(() => writeSidebarHidden(null, true)).not.toThrow()
  })
})
