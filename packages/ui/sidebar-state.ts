// Whether the sidebar is hidden, kept in the window's storage so a reload keeps it. The storage may be missing or throw (a private
// window, blocked site data); then the sidebar opens shown and a change is not kept.

export const SIDEBAR_HIDDEN_KEY = 'grove.sidebar-hidden'

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function readSidebarHidden(store: KeyValueStore | null): boolean {
  try {
    return store?.getItem(SIDEBAR_HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

export function writeSidebarHidden(store: KeyValueStore | null, hidden: boolean): void {
  try {
    store?.setItem(SIDEBAR_HIDDEN_KEY, hidden ? '1' : '0')
  } catch {
    // not kept: the sidebar still changes for this run
  }
}
