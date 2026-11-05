import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { INDICATOR_STATES, indicatorClass, indicatorLabel, type IndicatorState } from './indicator.ts'

const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8')

describe('indicator', () => {
  it('gives every state a label and a class', () => {
    expect(INDICATOR_STATES).toEqual(['needs-you', 'working', 'finished', 'unknown', 'idle'])
    for (const state of INDICATOR_STATES) {
      expect(indicatorLabel(state).length).toBeGreaterThan(0)
      expect(indicatorClass(state)).toBe(`indicator ind-${state}`)
    }
    expect(indicatorLabel('needs-you')).toBe('needs you')
  })

  it('has a styles.css rule for every state, coloured from its state token', () => {
    for (const state of INDICATOR_STATES as readonly IndicatorState[]) {
      const rule = new RegExp(`\\.ind-${state}\\s*\\{[^}]*var\\(--state-${state}\\)`)
      expect(css, `styles.css rule for .ind-${state}`).toMatch(rule)
    }
  })
})
