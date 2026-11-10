import { describe, expect, it } from 'vitest'
import {
  APPEARANCE_KEY,
  DEFAULT_AGENT_APPEARANCE,
  applyAgentAppearance,
  readAgentAppearance,
  writeAgentAppearance,
  type AgentAppearance,
} from './appearance-pref.ts'

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => void (data[key] = value),
  }
}

describe('agent appearance preference', () => {
  it('uses theme colors and thinking dots when no valid preference is stored', () => {
    expect(readAgentAppearance(null)).toEqual(DEFAULT_AGENT_APPEARANCE)
    expect(readAgentAppearance(memory({ [APPEARANCE_KEY]: '{broken' }))).toEqual(DEFAULT_AGENT_APPEARANCE)
  })

  it('round-trips independent state-color choices and the working-indicator style', () => {
    const store = memory()
    const choice: AgentAppearance = {
      needsYou: 'tile-1',
      working: null,
      finished: 'tile-1',
      workingIndicator: 'waveform',
    }

    writeAgentAppearance(store, choice)

    expect(readAgentAppearance(store)).toEqual(choice)
  })

  it('applies selected swatches as overrides and clears them for the theme default', () => {
    const properties = new Map<string, string>()
    const root = {
      dataset: {} as DOMStringMap,
      style: {
        setProperty: (name: string, value: string) => { properties.set(name, value) },
        removeProperty: (name: string) => {
          properties.delete(name)
          return ''
        },
      },
    }
    const choice: AgentAppearance = {
      needsYou: 'tile-2',
      working: 'tile-4',
      finished: null,
      workingIndicator: 'dots',
    }

    applyAgentAppearance(root, choice)
    expect(properties).toEqual(new Map([
      ['--agent-state-needs-you', 'var(--tile-2)'],
      ['--agent-state-working', 'var(--tile-4)'],
    ]))
    expect(root.dataset.workingIndicator).toBe('dots')

    applyAgentAppearance(root, DEFAULT_AGENT_APPEARANCE)
    expect(properties.size).toBe(0)
    expect(root.dataset.workingIndicator).toBe('dots')
  })
})
