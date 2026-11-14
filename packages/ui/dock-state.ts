// The right dock's width and whether it is expanded, kept in the window's storage so a reload keeps it.
import { flagPref, persistedPref, type KeyValueStore } from './persisted-pref.ts'

export const DOCK_WIDTH_KEY = 'grove.dock-width'
export const DOCK_WIDTH_DEFAULT = 360
export const DOCK_WIDTH_MIN = 280
export const DOCK_WIDTH_STEP = 24
export const DOCK_EXPANDED_KEY = 'grove.dock-expanded'
// The most of the window, in percent, the dock may take, so the grid keeps a usable share. Expanded is exactly this much.
export const DOCK_WINDOW_PERCENT = 70

// The widest the dock can be in a window this wide; never under the floor, so a small window still gets a usable dock.
export function dockCeiling(windowWidth: number): number {
  return Math.max(DOCK_WIDTH_MIN, Math.floor((windowWidth * DOCK_WINDOW_PERCENT) / 100))
}

export function clampDockWidth(width: number, windowWidth: number): number {
  if (!Number.isFinite(width)) return Math.min(DOCK_WIDTH_DEFAULT, dockCeiling(windowWidth))
  return Math.min(dockCeiling(windowWidth), Math.max(DOCK_WIDTH_MIN, Math.round(width)))
}

// The width the dock shows: the ceiling when expanded, else the saved width held under the ceiling.
export function dockWidthFor(saved: number, expanded: boolean, windowWidth: number): number {
  return expanded ? dockCeiling(windowWidth) : clampDockWidth(saved, windowWidth)
}

// The saved width is not held to the window here: the window may differ next time, so it is clamped when it is shown.
const dockWidth = persistedPref<number>({
  key: DOCK_WIDTH_KEY,
  fallback: () => DOCK_WIDTH_DEFAULT,
  decode: (text) => {
    const width = Number(text)
    return Number.isFinite(width) ? Math.max(DOCK_WIDTH_MIN, Math.round(width)) : undefined
  },
  encode: (width) => String(Math.max(DOCK_WIDTH_MIN, Math.round(width))),
})
const dockExpanded = flagPref(DOCK_EXPANDED_KEY, '1', '0')

export const readDockWidth = (store: KeyValueStore | null): number => dockWidth.read(store)
export const writeDockWidth = (store: KeyValueStore | null, width: number): void => dockWidth.write(store, width)
export const readDockExpanded = (store: KeyValueStore | null): boolean => dockExpanded.read(store)
export const writeDockExpanded = (store: KeyValueStore | null, expanded: boolean): void => dockExpanded.write(store, expanded)
