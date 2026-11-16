import { describe, expect, it } from 'vitest'
import { readSidebarFolds, readSidebarHidden, SIDEBAR_FOLDS_KEY, SIDEBAR_HIDDEN_KEY, writeSidebarFolds, writeSidebarHidden } from './sidebar-state.ts'
import type { KeyValueStore } from './persisted-pref.ts'

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
})

describe('sidebar folds', () => {
  it('opens every heading when nothing is stored', () => {
    expect(readSidebarFolds(memory())).toEqual([])
  })

  it('keeps the folded repos across a reload', () => {
    const store = memory()
    writeSidebarFolds(store, ['app', 'lib'], ['app', 'lib', 'other'])
    expect(readSidebarFolds(store)).toEqual(['app', 'lib'])
    writeSidebarFolds(store, [], ['app'])
    expect(readSidebarFolds(store)).toEqual([])
  })

  it('ignores stored data that is not a list of names', () => {
    const store = memory()
    for (const bad of ['not json', '{"app":true}', '"app"', 'null']) {
      store.values.set(SIDEBAR_FOLDS_KEY, bad)
      expect(readSidebarFolds(store), bad).toEqual([])
    }
    store.values.set(SIDEBAR_FOLDS_KEY, '["app", 3, null, "app", "lib"]')
    expect(readSidebarFolds(store)).toEqual(['app', 'lib'])
  })

  it('stops remembering a repo that no longer has a heading', () => {
    const store = memory()
    writeSidebarFolds(store, ['app', 'gone'], ['app'])
    expect(readSidebarFolds(store)).toEqual(['app'])
  })
})
