import type { KeyValueStore } from './sidebar-state.ts'

// How big the whole window is drawn, kept in the window's storage so a restart keeps it. 1 is the size the window is designed at.

export const ZOOM_KEY = 'grove.zoom'

export const DEFAULT_ZOOM = 1
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
// Levels are kept in tenths, so stepping never drifts off a round value (0.1 + 0.2 is not 0.3).
const ZOOM_STEP_TENTHS = 1

export type ZoomStep = 'in' | 'out' | 'reset'

function isZoom(value: number): boolean {
  return Number.isFinite(value) && value >= ZOOM_MIN && value <= ZOOM_MAX
}

export function readZoom(store: KeyValueStore | null): number {
  try {
    const value = Number(store?.getItem(ZOOM_KEY))
    return isZoom(value) ? value : DEFAULT_ZOOM
  } catch {
    return DEFAULT_ZOOM
  }
}

export function writeZoom(store: KeyValueStore | null, zoom: number): void {
  try {
    store?.setItem(ZOOM_KEY, String(zoom))
  } catch {
    // not kept: the zoom still holds for this run
  }
}

// The level after a zoom key, held between 50% and 300%.
export function stepZoom(zoom: number, step: ZoomStep): number {
  if (step === 'reset') return DEFAULT_ZOOM
  const tenths = Math.round(zoom * 10) + (step === 'in' ? ZOOM_STEP_TENTHS : -ZOOM_STEP_TENTHS)
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, tenths / 10))
}
