import { flagPref, type KeyValueStore } from './persisted-pref.ts'

// Whether the sidebar is hidden, kept in the window's storage so a reload keeps it. Shown when nothing is kept.

export const SIDEBAR_HIDDEN_KEY = 'grove.sidebar-hidden'

const sidebarHidden = flagPref(SIDEBAR_HIDDEN_KEY, '1', '0')

export const readSidebarHidden = (store: KeyValueStore | null): boolean => sidebarHidden.read(store)
export const writeSidebarHidden = (store: KeyValueStore | null, hidden: boolean): void => sidebarHidden.write(store, hidden)
