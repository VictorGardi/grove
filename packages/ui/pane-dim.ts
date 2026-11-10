import type { KeyValueStore } from './sidebar-state.ts'

// How dimmed the unfocused grid panes are, as their opacity, kept in the window's storage so a reload keeps it. Null when the human
// has not chosen one: the theme's --pane-unfocused-opacity then stands.

export const PANE_DIM_KEY = 'grove.pane-dim'
export const PANE_DIM_RANGE = { min: 0.1, max: 1, step: 0.05 }

export function clampPaneDim(value: number): number {
  return Math.min(PANE_DIM_RANGE.max, Math.max(PANE_DIM_RANGE.min, value))
}

export function readPaneDim(store: KeyValueStore | null): number | null {
  try {
    const text = store?.getItem(PANE_DIM_KEY)
    if (text === null || text === undefined) return null
    const value = Number(text)
    return Number.isFinite(value) ? clampPaneDim(value) : null
  } catch {
    return null
  }
}

export function writePaneDim(store: KeyValueStore | null, value: number): void {
  try {
    store?.setItem(PANE_DIM_KEY, String(clampPaneDim(value)))
  } catch {
    // not kept: the panes still change for this run
  }
}
