import { describe, expect, it, vi } from 'vitest'
import { readViewState, VIEW_STATE_KEY, writeViewState } from './view-state.ts'

describe('window view state', () => {
  it('keeps grid membership even when grid mode is off', () => {
    const data = new Map<string, string>()
    const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
    const state = { gridOn: false, gridTabs: ['tab-1', 'tab-2'], activeSpace: 'space-2', activeTab: 'tab-2' }
    writeViewState(store, state)
    expect(readViewState(store)).toEqual(state)
  })

  it('rejects malformed state and reports the failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const raw of ['{', 'null', '{"gridOn":true,"gridTabs":[42],"activeSpace":null,"activeTab":null}']) {
        expect(readViewState({ getItem: () => raw, setItem: () => {} })).toEqual({
          gridOn: false, gridTabs: [], activeSpace: null, activeTab: null,
        })
      }
      expect(warn).toHaveBeenCalledTimes(3)
    } finally {
      warn.mockRestore()
    }
  })

  it('tolerates unavailable storage and reports blocked writes', () => {
    expect(readViewState(null).gridOn).toBe(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      writeViewState({ getItem: () => null, setItem: () => { throw new Error('blocked') } }, {
        gridOn: true, gridTabs: ['tab-1'], activeSpace: 'space-1', activeTab: 'tab-1',
      })
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
    }
  })

  it('deduplicates grid members and enforces the grid limit', () => {
    const raw = JSON.stringify({ gridOn: true, gridTabs: ['tab-0', ...Array.from({ length: 12 }, (_, i) => `tab-${i}`)], activeSpace: null, activeTab: null })
    const getItem = vi.fn(() => raw)
    expect(readViewState({ getItem, setItem: () => {} }).gridTabs).toEqual(Array.from({ length: 9 }, (_, i) => `tab-${i}`))
    expect(getItem).toHaveBeenCalledWith(VIEW_STATE_KEY)
  })
})
