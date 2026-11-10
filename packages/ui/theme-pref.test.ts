import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { THEMES, THEME_KEY, applyThemeChoice, readTheme, writeTheme } from './theme-pref.ts'

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial }
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) }
}

describe('theme preference', () => {
  it('is grove with nothing stored, junk or no storage', () => {
    expect(readTheme(null)).toBe('grove')
    expect(readTheme(memory())).toBe('grove')
    expect(readTheme(memory({ [THEME_KEY]: 'neon' }))).toBe('grove')
  })
  it('round-trips a choice', () => {
    const store = memory()
    writeTheme(store, 'nord')
    expect(readTheme(store)).toBe('nord')
  })
  it('sets data-theme, and removes it for the default', () => {
    const root = { dataset: {} as DOMStringMap }
    applyThemeChoice(root, 'dracula')
    expect(root.dataset.theme).toBe('dracula')
    applyThemeChoice(root, 'grove')
    expect(root.dataset.theme).toBeUndefined()
  })
  it('has a themes.css block for every preset but the default', () => {
    const css = readFileSync(new URL('./src/themes.css', import.meta.url), 'utf8')
    for (const { id } of THEMES) {
      if (id !== 'grove') expect(css).toContain(`:root[data-theme='${id}']`)
    }
  })
})
