import { describe, expect, it, vi } from 'vitest'
import { readViewState, VIEW_STATE_KEY, writeViewState } from './view-state.ts'

describe('window view state', () => {
  it('keeps grid membership even when grid mode is off', () => {
    const data = new Map<string, string>()
    const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
    const state = { gridOn: false, gridTabs: ['tab-1', 'tab-2'], gridLayout: null, activeSpace: 'space-2', activeTab: 'tab-2' }
    writeViewState(store, state)
    expect(readViewState(store)).toEqual(state)
  })

  it('rejects malformed state and reports the failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const raw of ['{', 'null', '{"gridOn":true,"gridTabs":[42],"activeSpace":null,"activeTab":null}']) {
        expect(readViewState({ getItem: () => raw, setItem: () => {} })).toEqual({
          gridOn: false, gridTabs: [], gridLayout: null, activeSpace: null, activeTab: null,
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
        gridOn: true, gridTabs: ['tab-1'], gridLayout: null, activeSpace: 'space-1', activeTab: 'tab-1',
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

  it('keeps a custom grid layout across a restart', () => {
    const data = new Map<string, string>()
    const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
    const gridLayout = { dir: 'row' as const, ratio: 0.3, a: 'tab-1', b: { dir: 'col' as const, ratio: 0.6, a: 'tab-2', b: 'tab-3' } }
    const state = { gridOn: true, gridTabs: ['tab-1', 'tab-2', 'tab-3'], gridLayout, activeSpace: null, activeTab: 'tab-1' }
    writeViewState(store, state)
    expect(readViewState(store)).toEqual(state)
  })

  it('reads state saved before layouts existed as the automatic layout', () => {
    const raw = JSON.stringify({ gridOn: true, gridTabs: ['tab-1'], activeSpace: null, activeTab: 'tab-1' })
    expect(readViewState({ getItem: () => raw, setItem: () => {} })).toEqual({
      gridOn: true, gridTabs: ['tab-1'], gridLayout: null, activeSpace: null, activeTab: 'tab-1',
    })
  })

  it('falls back to the automatic layout for a corrupt tree and keeps the rest', () => {
    const raw = JSON.stringify({ gridOn: true, gridTabs: ['tab-1', 'tab-2'], gridLayout: { dir: 'row', ratio: 'wide', a: 'tab-1', b: 'tab-2' }, activeSpace: 's', activeTab: 'tab-2' })
    expect(readViewState({ getItem: () => raw, setItem: () => {} })).toEqual({
      gridOn: true, gridTabs: ['tab-1', 'tab-2'], gridLayout: null, activeSpace: 's', activeTab: 'tab-2',
    })
  })
})
