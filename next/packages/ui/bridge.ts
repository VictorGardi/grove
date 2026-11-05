import { Channel, invoke } from '@tauri-apps/api/core'
import type {
  JsonRpcResponse,
  JsonRpcSuccess,
  MethodMap,
  MethodName,
  NotificationMap,
} from '../protocol/messages.ts'

export type BridgeStatus = 'open' | 'closed'
type NotificationName = keyof NotificationMap

export interface Bridge {
  connect(): Promise<void>
  rpc<M extends MethodName>(method: M, params: MethodMap[M]['params']): Promise<MethodMap[M]['result']>
  on<N extends NotificationName>(method: N, handler: (params: NotificationMap[N]) => void): void
  onStatus(handler: (status: BridgeStatus) => void): void
}

const CLOSED = 'bridge.closed'

export function createBridge(): Bridge {
  let nextId = 1
  let reconnecting = false
  const handlers = new Map<string, Array<(params: never) => void>>()
  const statusHandlers: Array<(status: BridgeStatus) => void> = []
  // Made on first use, not here: a channel needs the Tauri runtime, and the states page runs in a browser without it.
  let events: Channel<string> | undefined
  const eventChannel = (): Channel<string> => {
    if (events) return events
    events = new Channel<string>()
    events.onmessage = (line) => {
      const message = JSON.parse(line) as { method?: string; params?: unknown }
      if (message.method === CLOSED) {
        emitStatus('closed')
        void reconnect()
        return
      }
      for (const handler of handlers.get(message.method ?? '') ?? []) handler(message.params as never)
    }
    return events
  }

  const emitStatus = (status: BridgeStatus) => {
    for (const handler of statusHandlers) handler(status)
  }

  const reconnect = async () => {
    if (reconnecting) return
    reconnecting = true
    let delay = 300
    for (;;) {
      try {
        await invoke('connect', { events: eventChannel() })
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay = Math.min(delay * 2, 3000)
      }
    }
    reconnecting = false
    emitStatus('open')
  }

  return {
    async connect() {
      await invoke('connect', { events: eventChannel() })
    },
    async rpc(method, params) {
      const id = nextId++
      const line = await invoke<string>('rpc', { request: { jsonrpc: '2.0', id, method, params: params ?? {} } })
      const response = JSON.parse(line) as JsonRpcResponse
      if ('error' in response) throw Object.assign(new Error(response.error.message), { code: response.error.code })
      return (response as JsonRpcSuccess).result as never
    },
    on(method, handler) {
      const list = handlers.get(method) ?? []
      list.push(handler as (params: never) => void)
      handlers.set(method, list)
    },
    onStatus(handler) {
      statusHandlers.push(handler)
    },
  }
}

const CHUNK = 0x8000

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function fromBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
}
