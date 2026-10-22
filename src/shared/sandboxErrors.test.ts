import { describe, expect, it } from 'vitest'
import { ERROR_MESSAGES, errorMessage } from './sandboxErrors'

describe('errorMessage', () => {
  it('turns a code into the sentence that fixes it', () => {
    expect(errorMessage('no-sandbox-no-bridge')).toMatch(/container system start/)
    expect(errorMessage('no-sandbox-no-container')).toMatch(/install it/)
    expect(errorMessage('no-sandbox-no-service')).toMatch(/opencode/)
    expect(errorMessage('no-sandbox-no-credential')).toMatch(/claude setup-token/)
    expect(errorMessage('no-sandbox-kind')).toMatch(/terminal/)
    expect(errorMessage('no-sandbox-kind')).toMatch(/Copilot/)
    expect(errorMessage('no-copilot')).toMatch(/copilot login/)
  })

  // The thing that was actually wrong: a missing bridge used to tell you to install Docker, and a
  // missing OpenCode service told you to set up a Claude token. Both were true sentences about a
  // different failure.
  it('never points at the wrong fix', () => {
    for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
      if (!code.startsWith('no-sandbox')) continue
      expect(message.length, code).toBeGreaterThan(20)
      if (code === 'no-sandbox-no-credential') expect(message).toMatch(/claude setup-token/)
      else expect(message, code).not.toMatch(/claude setup-token/)
    }
  })

  it('gives every sandbox refusal its own sentence', () => {
    const sandbox = Object.entries(ERROR_MESSAGES).filter(([c]) => c.startsWith('no-sandbox'))
    expect(new Set(sandbox.map(([, m]) => m)).size).toBe(sandbox.length)
    expect(sandbox.length).toBeGreaterThanOrEqual(7)
  })

  // A new failure must never come out blank: the worst case is the bare code, which is what the GUI
  // showed before this table existed.
  it('falls back to the code itself for anything it does not know', () => {
    expect(errorMessage('nonsense')).toBe('nonsense')
    expect(errorMessage('')).toBe('')
  })
})