import type { KeyValueStore } from './sidebar-state.ts'

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

export function readTheme(store: KeyValueStore | null): ThemeId {
  try {
    const value = store?.getItem(THEME_KEY)
    return isThemeId(value) ? value : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function writeTheme(store: KeyValueStore | null, theme: ThemeId): void {
  try {
    store?.setItem(THEME_KEY, theme)
  } catch {
    // not kept: the theme still holds for this run
  }
}

// Puts the theme on the root: the default removes the attribute, so the tokens.css values stand.
export function applyThemeChoice(root: { dataset: DOMStringMap }, theme: ThemeId): void {
  if (theme === DEFAULT_THEME) delete root.dataset.theme
  else root.dataset.theme = theme
}
