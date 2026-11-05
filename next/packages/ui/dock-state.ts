// The right dock's width, kept in the window's storage so a reload keeps it. The storage may be missing or throw (a private window,
// blocked site data); then the dock opens at its default width and a change is not kept.
import type { KeyValueStore } from './sidebar-state.ts'

export const DOCK_WIDTH_KEY = 'grove-next.dock-width'
export const DOCK_WIDTH_DEFAULT = 360
export const DOCK_WIDTH_MIN = 280
export const DOCK_WIDTH_MAX = 640
export const DOCK_WIDTH_STEP = 24

export function clampDockWidth(width: number): number {
  if (!Number.isFinite(width)) return DOCK_WIDTH_DEFAULT
  return Math.min(DOCK_WIDTH_MAX, Math.max(DOCK_WIDTH_MIN, Math.round(width)))
}

export function readDockWidth(store: KeyValueStore | null): number {
  try {
    const saved = store?.getItem(DOCK_WIDTH_KEY)
    return saved == null ? DOCK_WIDTH_DEFAULT : clampDockWidth(Number(saved))
  } catch {
    return DOCK_WIDTH_DEFAULT
  }
}

export function writeDockWidth(store: KeyValueStore | null, width: number): void {
  try {
    store?.setItem(DOCK_WIDTH_KEY, String(clampDockWidth(width)))
  } catch {
    // not kept: the dock still changes for this run
  }
}
