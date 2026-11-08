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

  it('names the minimum version for a live agent tab with no status report', () => {
    expect(indicatorLabel('unknown', 'copilot', true)).toBe(
      'no status report yet; requires Copilot 1.0.107 or later',
    )
    expect(indicatorLabel('unknown', 'opencode', true)).toBe(
      'no status report yet; requires OpenCode 2.2.6 or later',
    )
    expect(indicatorLabel('unknown', 'claude', true)).toBe(
      'no status report yet; requires Claude 2.1.309 or later',
    )
  })

  it('does not show a version hint without a live agent tab', () => {
    expect(indicatorLabel('unknown')).toBe('unknown')
    expect(indicatorLabel('unknown', 'claude', false)).toBe('unknown')
    expect(indicatorLabel('working', 'claude', true)).toBe('working')
  })

  it('has a styles.css rule for every state, coloured from its state token', () => {
    for (const state of INDICATOR_STATES as readonly IndicatorState[]) {
      const rule = new RegExp(`\\.ind-${state}(?:::before)?\\s*\\{[^}]*var\\(--state-${state}\\)`)
      expect(css, `styles.css rule for .ind-${state}`).toMatch(rule)
    }
  })

  it('keeps a fixed-width indicator slot and pulses working dots without rotation', () => {
    expect(css).toMatch(/\.indicator\s*\{[^}]*width:\s*var\(--ind-container-width\)/)
    expect(css).toMatch(/\.agent-thinking-dot\s*\{[^}]*animation:\s*thinking-dot/)
    expect(css).toMatch(/\.agent-thinking-dot\s*\{[^}]*will-change:\s*transform,\s*opacity/)
    expect(css).toMatch(/\.agent-thinking-dot\s*\{[^}]*transform:\s*translateZ\(0\)/)
    expect(css).toMatch(/@keyframes thinking-dot/)
    expect(css).toMatch(/\.agent-wave-bar\s*\{[^}]*animation:\s*waveform-bar/)
    expect(css).toMatch(/\.agent-waveform\s*\{[^}]*width:\s*var\(--ind-wave-width\)/)
    expect(css).toMatch(/\.agent-wave-bar\s*\{[^}]*width:\s*var\(--ind-wave-bar-width\)/)
    expect(css).toMatch(/\.agent-wave-bar:nth-child\(1\)\s*\{[^}]*animation-duration:\s*var\(--ind-wave-period-before\)/)
    expect(css).toMatch(/\.agent-wave-bar:nth-child\(3\)\s*\{[^}]*animation-duration:\s*var\(--ind-wave-period-after\)/)
    expect(css).toMatch(/@keyframes waveform-bar\s*\{[\s\S]*?scaleY\(0\.3\)[\s\S]*?scaleY\(1\)/)
    const reducedMotionRules = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\s*\}/g)]
      .map((match) => match[1] ?? '')
    expect(reducedMotionRules.some((rule) => rule.includes('.agent-wave-bar') && /animation:\s*none/.test(rule))).toBe(true)
    expect(css).not.toMatch(/working-wave|animation:\s*spin/)
  })
})
