import { describe, expect, it } from 'vitest'
import { errorMessage } from './sessionErrors'

describe('errorMessage', () => {
  it('turns a code into the sentence that fixes it', () => {
    expect(errorMessage('no-copilot')).toMatch(/copilot login/)
    expect(errorMessage('not-found')).toMatch(/no such session/)
  })

  // A new failure must never come out blank: the worst case is the bare code, which is what the GUI
  // showed before this table existed.
  it('falls back to the code itself for anything it does not know', () => {
    expect(errorMessage('nonsense')).toBe('nonsense')
    expect(errorMessage('')).toBe('')
  })
})
