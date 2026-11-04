import { describe, expect, it } from 'vitest'
import { b64ToBytes, bytesToB64, createLineDecoder, encodeLine } from './framing.ts'

describe('framing', () => {
  it('round-trips a multi-line payload', () => {
    const message = { jsonrpc: '2.0', id: 1, result: { text: 'line one\nline two\n' } }
    const lines: string[] = []
    const push = createLineDecoder((line) => lines.push(line))

    push(encodeLine(message) + encodeLine({ second: true }))

    expect(lines.map((line) => JSON.parse(line))).toEqual([message, { second: true }])
  })

  it('reassembles a line split across three chunks', () => {
    const line = encodeLine({ dataB64: bytesToB64(Buffer.from('héllo\nworld')) })
    const cut1 = Math.floor(line.length / 3)
    const cut2 = Math.floor((2 * line.length) / 3)
    const lines: string[] = []
    const push = createLineDecoder((value) => lines.push(value))

    push(line.slice(0, cut1))
    expect(lines).toEqual([])
    push(line.slice(cut1, cut2))
    expect(lines).toEqual([])
    push(line.slice(cut2))

    expect(lines).toHaveLength(1)
    const decoded = JSON.parse(lines[0]!) as { dataB64: string }
    expect(b64ToBytes(decoded.dataB64).toString('utf8')).toBe('héllo\nworld')
  })

  it('reassembles a multi-byte character split across Buffer chunks', () => {
    const bytes = Buffer.from(encodeLine({ text: 'é€' }))
    const lines: string[] = []
    const push = createLineDecoder((value) => lines.push(value))

    push(bytes.subarray(0, 10))
    push(bytes.subarray(10))

    expect(JSON.parse(lines[0]!)).toEqual({ text: 'é€' })
  })
})
