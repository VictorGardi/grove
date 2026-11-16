import { flagPref, persistedPref, type KeyValueStore } from './persisted-pref.ts'

// Whether the sidebar is hidden, kept in the window's storage so a reload keeps it. Shown when nothing is kept.

export const SIDEBAR_HIDDEN_KEY = 'grove.sidebar-hidden'

const sidebarHidden = flagPref(SIDEBAR_HIDDEN_KEY, '1', '0')

export const readSidebarHidden = (store: KeyValueStore | null): boolean => sidebarHidden.read(store)
export const writeSidebarHidden = (store: KeyValueStore | null, hidden: boolean): void => sidebarHidden.write(store, hidden)

// The repos whose heading is folded, kept in the window's storage as a JSON list of repo names. Every heading is open when
// nothing valid is kept.

export const SIDEBAR_FOLDS_KEY = 'grove.sidebar-folds'

const sidebarFolds = persistedPref<string[]>({
  key: SIDEBAR_FOLDS_KEY,
  fallback: () => [],
  decode: (text) => {
    const value: unknown = JSON.parse(text)
    return Array.isArray(value) ? [...new Set(value.filter((repo): repo is string => typeof repo === 'string'))] : undefined
  },
  encode: (repos) => JSON.stringify(repos),
})

export const readSidebarFolds = (store: KeyValueStore | null): string[] => sidebarFolds.read(store)
// Only repos that still have a heading are kept: a repo that is gone stops being remembered.
export const writeSidebarFolds = (store: KeyValueStore | null, folded: string[], repos: string[]): void =>
  sidebarFolds.write(store, folded.filter((repo) => repos.includes(repo)))
