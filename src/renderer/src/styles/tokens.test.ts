import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chromeBackground, terminalTheme } from '@shared/theme'

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
const tokens = Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toLowerCase()]))

describe('tokens.css and shared/theme.ts', () => {
  it('agree on the values both define', () => {
    expect(tokens['--chrome-bg']).toBe(chromeBackground.toLowerCase())
    expect(tokens['--terminal-bg']).toBe(terminalTheme.background.toLowerCase())
    expect(tokens['--terminal-fg']).toBe(terminalTheme.foreground.toLowerCase())
  })

  it('gives the terminal all 16 ANSI colours', () => {
    const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
    for (const n of names) {
      expect(terminalTheme).toHaveProperty(n)
      expect(terminalTheme).toHaveProperty(`bright${n[0].toUpperCase()}${n.slice(1)}`)
    }
  })
})
