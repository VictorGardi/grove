import { describe, expect, it } from 'vitest'
import { LAUNCH_KINDS } from './launchKinds'

describe('LAUNCH_KINDS', () => {
  it('shows Copilot third and Terminal fourth', () => {
    expect(LAUNCH_KINDS.map((k) => k.kind)).toEqual(['claude', 'opencode', 'copilot', 'terminal'])
  })

  it('keeps the existing shortcuts and gives Copilot Digit4', () => {
    const code = (kind: string) => LAUNCH_KINDS.find((k) => k.kind === kind)?.code
    expect(code('claude')).toBe('Digit1')
    expect(code('opencode')).toBe('Digit2')
    expect(code('terminal')).toBe('Digit3')
    expect(code('copilot')).toBe('Digit4')
  })

  it('has a unique code and a matching key label for each', () => {
    expect(new Set(LAUNCH_KINDS.map((k) => k.code)).size).toBe(LAUNCH_KINDS.length)
    for (const k of LAUNCH_KINDS) expect(k.code).toBe('Digit' + k.key)
  })
})
