import { persistedPref, type KeyValueStore } from './persisted-pref.ts'

// The colour theme of the window, kept in the window's storage so a reload keeps it. The id is the `data-theme` on the root, and
// src/themes.css has a block for each one. 'grove' is the plain tokens.css and sets no attribute.

export const THEME_KEY = 'grove.theme'

export const THEMES = [
  { id: 'grove', label: 'Grove' },
  { id: 'mocha', label: 'Catppuccin Mocha' },
  { id: 'macchiato', label: 'Catppuccin Macchiato' },
  { id: 'tokyo-night', label: 'Tokyo Night' },
  { id: 'tokyo-night-storm', label: 'Tokyo Night Storm' },
  { id: 'rose-pine', label: 'Rosé Pine' },
  { id: 'gruvbox', label: 'Gruvbox Dark' },
  { id: 'nord', label: 'Nord' },
  { id: 'dracula', label: 'Dracula' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

export const DEFAULT_THEME: ThemeId = 'grove'

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

const theme = persistedPref<ThemeId>({
  key: THEME_KEY,
  fallback: () => DEFAULT_THEME,
  decode: (text) => (isThemeId(text) ? text : undefined),
  encode: (value) => value,
})

export const readTheme = (store: KeyValueStore | null): ThemeId => theme.read(store)
export const writeTheme = (store: KeyValueStore | null, value: ThemeId): void => theme.write(store, value)

// Puts the theme on the root: the default removes the attribute, so the tokens.css values stand.
export function applyThemeChoice(root: { dataset: DOMStringMap }, theme: ThemeId): void {
  if (theme === DEFAULT_THEME) delete root.dataset.theme
  else root.dataset.theme = theme
}
