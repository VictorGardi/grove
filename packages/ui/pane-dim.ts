import { persistedPref, type KeyValueStore } from './persisted-pref.ts'

// How dimmed the unfocused grid panes are, as their opacity, kept in the window's storage so a reload keeps it. Null when the human
// has not chosen one: the theme's --pane-unfocused-opacity then stands.

export const PANE_DIM_KEY = 'grove.pane-dim'
export const PANE_DIM_RANGE = { min: 0.1, max: 1, step: 0.05 }

export function clampPaneDim(value: number): number {
  return Math.min(PANE_DIM_RANGE.max, Math.max(PANE_DIM_RANGE.min, value))
}

const paneDim = persistedPref<number | null>({
  key: PANE_DIM_KEY,
  fallback: () => null,
  decode: (text) => {
    const value = Number(text)
    return Number.isFinite(value) ? clampPaneDim(value) : undefined
  },
  encode: (value) => String(clampPaneDim(value ?? PANE_DIM_RANGE.max)),
})

export const readPaneDim = (store: KeyValueStore | null): number | null => paneDim.read(store)
export const writePaneDim = (store: KeyValueStore | null, value: number): void => paneDim.write(store, value)
