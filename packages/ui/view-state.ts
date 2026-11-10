import { GRID_MAX } from './grid/layout.ts'
import { readTree, type Tree } from './grid/tree.ts'
import type { KeyValueStore } from './sidebar-state.ts'

export const VIEW_STATE_KEY = 'grove.view-state'

export interface ViewState {
  gridOn: boolean
  gridTabs: string[]
  // The custom grid layout, or null while the grid arranges itself.
  gridLayout: Tree | null
  activeSpace: string | null
  activeTab: string | null
}

const empty = (): ViewState => ({ gridOn: false, gridTabs: [], gridLayout: null, activeSpace: null, activeTab: null })
const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string'

export function readViewState(store: KeyValueStore | null): ViewState {
  try {
    const raw = store?.getItem(VIEW_STATE_KEY)
    if (!raw) return empty()
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) throw new Error('invalid view state')
    const state = value as Record<string, unknown>
    if (typeof state.gridOn !== 'boolean' || !Array.isArray(state.gridTabs) ||
        !state.gridTabs.every((id: unknown) => typeof id === 'string') ||
        !nullableString(state.activeSpace) || !nullableString(state.activeTab)) throw new Error('invalid view state')
    return { gridOn: state.gridOn, gridTabs: [...new Set<string>(state.gridTabs)].slice(0, GRID_MAX), gridLayout: readTree(state.gridLayout), activeSpace: state.activeSpace, activeTab: state.activeTab }
  } catch (error) {
    console.warn('Could not restore window view state', error)
    return empty()
  }
}

export function writeViewState(store: KeyValueStore | null, state: ViewState): void {
  try {
    store?.setItem(VIEW_STATE_KEY, JSON.stringify(state))
  } catch (error) {
    console.warn('Could not save window view state', error)
  }
}
