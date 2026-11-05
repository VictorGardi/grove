import net from 'node:net'
import { createLineDecoder, encodeLine } from './framing.ts'
import type { JsonRpcFailure, JsonRpcId, JsonRpcResponse, MethodMap, MethodName, NotificationMap } from './messages.ts'

export type NotificationName = keyof NotificationMap

export interface RpcClient {
  request<M extends MethodName>(method: M, params: MethodMap[M]['params']): Promise<MethodMap[M]['result']>
  onNotification<N extends NotificationName>(method: N, handler: (params: NotificationMap[N]) => void): void
  close(): void
}

export function connectRpc(socketPath: string): Promise<RpcClient> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    let nextId = 1
    const pending = new Map<JsonRpcId, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
    const handlers = new Map<string, Array<(params: unknown) => void>>()

    const onLine = (line: string) => {
      const message = JSON.parse(line) as JsonRpcResponse & { method?: string; params?: unknown }
      if (message.method !== undefined) {
        for (const handler of handlers.get(message.method) ?? []) handler(message.params)
        return
      }
      const waiter = pending.get(message.id as JsonRpcId)
      if (!waiter) return
      pending.delete(message.id as JsonRpcId)
      if ('error' in message) waiter.reject(new Error((message as JsonRpcFailure).error.message))
      else waiter.resolve((message as { result: unknown }).result)
    }
    const decode = createLineDecoder(onLine)

    socket.on('data', decode)
    socket.on('error', (error) => {
      reject(error)
      for (const waiter of pending.values()) waiter.reject(error)
      pending.clear()
    })
    socket.on('close', () => {
      for (const waiter of pending.values()) waiter.reject(new Error('connection closed'))
      pending.clear()
    })

    socket.on('connect', () => {
      resolve({
        request(method, params) {
          const id = nextId++
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res as (v: unknown) => void, reject: rej })
            socket.write(encodeLine({ jsonrpc: '2.0', id, method, params }))
          })
        },
        onNotification(method, handler) {
          const list = handlers.get(method) ?? []
          list.push(handler as (params: unknown) => void)
          handlers.set(method, list)
        },
        close() {
          socket.destroy()
        },
      })
    })
  })
}

// Retries connectRpc until the socket accepts a connection or the timeout passes.
export async function connectWhenReady(socketPath: string, timeoutMs = 8000): Promise<RpcClient> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return await connectRpc(socketPath)
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}
