import { describe, expect, it, vi } from 'vitest'
import type { StatusChange } from '../protocol/messages.ts'
import { createBridge, fromBase64, toBase64 } from './bridge.ts'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  Channel: class<T> {
    onmessage: ((message: T) => void) | undefined
  },
}))

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

describe('bridge notifications', () => {
  it('passes a status.changed notification to its handlers', async () => {
    invoke.mockResolvedValue(undefined)
    const bridge = createBridge()
    const seen: StatusChange[] = []
    bridge.on('status.changed', (change) => seen.push(change))
    await bridge.connect()

    const events = invoke.mock.calls.at(-1)![1].events as { onmessage: (line: string) => void }
    const change: StatusChange = { tabId: 'abc12345', state: 'needs-you', reason: 'permission', since: 42, source: 'claude' }
    events.onmessage(JSON.stringify({ jsonrpc: '2.0', method: 'status.changed', params: change }))
    expect(seen).toEqual([change])
  })
})
