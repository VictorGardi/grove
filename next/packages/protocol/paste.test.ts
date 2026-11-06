import { describe, expect, it } from 'vitest'
import { bracketedPaste } from './paste.ts'

describe('bracketedPaste', () => {
  it('wraps the text as one bracketed paste and keeps newlines and tabs', () => {
    expect(bracketedPaste('hi\n\tthere')).toBe('\x1b[200~hi\n\tthere\x1b[201~')
  })

  it('strips control characters, so a pasted end marker cannot end the paste early', () => {
    expect(bracketedPaste('a\x1b[201~\x07b\r')).toBe('\x1b[200~a[201~b\x1b[201~')
  })
})
