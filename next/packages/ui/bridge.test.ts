import { describe, expect, it } from 'vitest'
import { fromBase64, toBase64 } from './bridge.ts'

describe('base64 helpers', () => {
  it('round-trips bytes, including multi-byte UTF-8 and chunk-size inputs', () => {
    const text = 'shell ✓ 日本語\x1b[31m\n'.repeat(12000)
    const bytes = new TextEncoder().encode(text)
    expect(new TextDecoder().decode(fromBase64(toBase64(bytes)))).toBe(text)
  })

  it('matches the framing module encoding', () => {
    expect(toBase64(new TextEncoder().encode('hi\n'))).toBe(Buffer.from('hi\n').toString('base64'))
  })
})
