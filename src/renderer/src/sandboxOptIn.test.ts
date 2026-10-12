import { describe, expect, it } from 'vitest'
import type { SessionKind } from '@shared/types'
import { SANDBOX_DEFAULT, sandboxable, wantsSandbox } from './sandboxOptIn'

describe('sandboxable', () => {
  // Both agents, and not a terminal: it has no agent argv to wrap. A sandboxed OpenCode joins the
  // host's shared service rather than registering its own, which is what keeps the incumbent alive
  // (ADR 0034, D6).
  it('is every agent kind, and not a terminal', () => {
    expect(sandboxable('claude')).toBe(true)
    expect(sandboxable('opencode')).toBe(true)
    expect(sandboxable('terminal')).toBe(false)
  })
})

describe('wantsSandbox', () => {
  it('follows the toggle for a sandboxable kind', () => {
    expect(wantsSandbox('claude', true)).toBe(true)
    expect(wantsSandbox('claude', false)).toBe(false)
  })

  // The guard that matters: the form may leave the toggle on from a previous kind, but an
  // unsandboxable kind must never reach core with the flag set, or the create is refused
  // `no-sandbox` and the human loses the session over a switch they cannot see.
  it('is false for an unsandboxable kind however the toggle is left', () => {
    for (const kind of ['terminal'] as SessionKind[]) {
      expect(wantsSandbox(kind, true)).toBe(false)
      expect(wantsSandbox(kind, false)).toBe(false)
    }
  })
})

describe('SANDBOX_DEFAULT', () => {
  // 03-design.md "Default off"; 01-questions.md "not a default for every session"; ADR 0033
  // rejects "making sandboxing the default" outright. The toggle starts where the human is not
  // asking for containment they did not request.
  it('is off', () => {
    expect(SANDBOX_DEFAULT).toBe(false)
  })
})
