import { describe, expect, it, vi } from 'vitest'
import type { StatusChange } from '../protocol/messages.ts'
import { createBridge } from './bridge.ts'

// Tauri's channels number their messages: a JS Channel delivers only the message whose index it expects next and parks the
// rest, and each Rust-side channel (made from the one passed to a command) counts from 0. This fake keeps both rules.
const tauri = vi.hoisted(() => {
  class Channel<T> {
    onmessage: ((message: T) => void) | undefined
    nextIndex = 0
    receive(message: T, index: number): void {
      if (index === this.nextIndex) {
        this.nextIndex++
        this.onmessage?.(message)
      }
    }
  }
  // The Rust side of each connect call: its own counter, sending into the channel it was given.
  const rust: Array<(line: string) => void> = []
  const invoke = vi.fn(async (command: string, args?: { events: Channel<string> }) => {
    if (command !== 'connect') return undefined
    const channel = args!.events
    let index = 0
    rust.push((line) => channel.receive(line, index++))
  })
  return { Channel, invoke, rust }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke, Channel: tauri.Channel }))

const CHANGE: StatusChange = { tabId: 'abc12345', agent: 'claude', state: 'working', since: 1, source: 'claude' }
const line = (method: string, params: unknown) => JSON.stringify({ jsonrpc: '2.0', method, params })

describe('bridge reconnect', () => {
  it('still delivers notifications after the core connection is made again', async () => {
    const bridge = createBridge()
    const seen: StatusChange[] = []
    bridge.on('status.changed', (change) => seen.push(change))
    const opened = new Promise<void>((resolve) => bridge.onStatus((status) => status === 'open' && resolve()))
    await bridge.connect()
    const first = tauri.rust.at(-1)!
    first(line('status.changed', CHANGE))
    expect(seen).toHaveLength(1)

    first(line('bridge.closed', {}))
    await opened
    const second = tauri.rust.at(-1)!
    expect(second).not.toBe(first)
    second(line('status.changed', CHANGE))
    expect(seen).toHaveLength(2)
  })
})
