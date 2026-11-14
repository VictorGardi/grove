import { GRID_MAX } from './grid/layout.ts'
import { readTree, type Tree } from './grid/tree.ts'
import { persistedPref, type KeyValueStore } from './persisted-pref.ts'

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

function decodeViewState(raw: string): ViewState | undefined {
  if (!raw) return undefined
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null) throw new Error('invalid view state')
  const state = value as Record<string, unknown>
  if (typeof state.gridOn !== 'boolean' || !Array.isArray(state.gridTabs) ||
      !state.gridTabs.every((id: unknown) => typeof id === 'string') ||
      !nullableString(state.activeSpace) || !nullableString(state.activeTab)) throw new Error('invalid view state')
  return { gridOn: state.gridOn, gridTabs: [...new Set<string>(state.gridTabs)].slice(0, GRID_MAX), gridLayout: readTree(state.gridLayout), activeSpace: state.activeSpace, activeTab: state.activeTab }
}

const viewState = persistedPref<ViewState>({
  key: VIEW_STATE_KEY,
  fallback: empty,
  decode: decodeViewState,
  encode: JSON.stringify,
  onFailure: (action, error) => console.warn(action === 'read' ? 'Could not restore window view state' : 'Could not save window view state', error),
})

export const readViewState = (store: KeyValueStore | null): ViewState => viewState.read(store)
export const writeViewState = (store: KeyValueStore | null, state: ViewState): void => viewState.write(store, state)

// Where the window keeps its view state: browser storage in production, memory in tests, nothing in the states demo.
export interface ViewStatePort {
  read(): ViewState
  write(state: ViewState): void
}

export function storageViewState(store: () => KeyValueStore | null): ViewStatePort {
  return { read: () => readViewState(store()), write: (state) => writeViewState(store(), state) }
}

export const noViewState: ViewStatePort = { read: empty, write: () => {} }

// Keeps what was written, starting from `saved`; `writes` lists every write in order.
export function memoryViewState(saved: Partial<ViewState> = {}): ViewStatePort & { saved: ViewState; writes: ViewState[] } {
  const port = {
    saved: { ...empty(), ...saved },
    writes: [] as ViewState[],
    read: () => structuredClone(port.saved),
    write(state: ViewState) {
      port.saved = structuredClone(state)
      port.writes.push(port.saved)
    },
  }
  return port
}
