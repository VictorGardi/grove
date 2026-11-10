import fs from 'node:fs'
import net from 'node:net'
import { holderSocketPath } from '../protocol/paths.ts'
import { bytesToB64, b64ToBytes, createLineDecoder, encodeLine } from '../protocol/framing.ts'
import { ERROR_CODES, METHODS, PROTOCOL_VERSION } from '../protocol/messages.ts'
import type { JsonRpcId, JsonRpcRequest, MethodMap, MethodName } from '../protocol/messages.ts'
import { PtyTable, TabError, type Attachment } from './pty-table.ts'

export interface HolderServer {
  socketPath: string
  table: PtyTable
  close: () => Promise<void>
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

export async function startHolderServer(
  options: { socketPath?: string; table?: PtyTable } = {},
): Promise<HolderServer> {
  const socketPath = options.socketPath ?? holderSocketPath()
  const table = options.table ?? new PtyTable()
  await removeStaleSocket(socketPath)

  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    const attachments = new Map<string, () => void>()
    // Attaches to one tab run one after another on this socket. The older listener is
    // detached before the newer one is registered, so output is never sent twice.
    const attachQueues = new Map<string, Promise<unknown>>()
    const send = (message: unknown) => {
      if (!socket.destroyed) socket.write(encodeLine(message))
    }
    const unsubscribeStatus = table.onStatus((id, status) => send(notification(METHODS.tabsStatus, { id, ...status })))
    const detachAll = () => {
      for (const detach of attachments.values()) detach()
      attachments.clear()
    }
    const handleLine = async (line: string) => {
      let request: JsonRpcRequest
      try {
        request = JSON.parse(line) as JsonRpcRequest
      } catch {
        send(failure(null, ERROR_CODES.parse, 'parse error'))
        return
      }
      if (typeof request !== 'object' || request === null || typeof request.method !== 'string') {
        send(failure(null, ERROR_CODES.invalidRequest, 'invalid request'))
        return
      }
      let flushAfterReply: (() => void) | undefined
      try {
        const result = await dispatch(request.method, request.params, {
          table,
          attach: (id) => {
            const attaching = (attachQueues.get(id) ?? Promise.resolve()).then(async () => {
              attachments.get(id)?.()
              attachments.delete(id)
              const attached = await table.attach(id, {
                onOutput: (data) => send(notification('tabs.output', { id, dataB64: bytesToB64(Buffer.from(data)) })),
                onExit: (exitCode) => {
                  attachments.delete(id)
                  send(notification('tabs.exit', { id, exitCode }))
                },
              })
              if (socket.destroyed) attached.detach()
              else attachments.set(id, attached.detach)
              flushAfterReply = attached.flush
              return attached
            })
            attachQueues.set(id, attaching.catch(() => undefined))
            return attaching
          },
        })
        if (request.id !== undefined) send({ jsonrpc: '2.0', id: request.id, result })
        flushAfterReply?.()
      } catch (error) {
        if (request.id !== undefined) send(toFailure(request.id, error))
      }
    }
    const decode = createLineDecoder((line) => void handleLine(line))
    socket.on('data', decode)
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      detachAll()
      unsubscribeStatus()
      sockets.delete(socket)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      resolve()
    })
  })
  fs.chmodSync(socketPath, 0o600)

  return {
    socketPath,
    table,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => {
          fs.rmSync(socketPath, { force: true })
          resolve()
        })
      }),
  }
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  if (!fs.existsSync(socketPath)) return
  const live = await new Promise<boolean>((resolve) => {
    const probe = net.createConnection(socketPath)
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', () => resolve(false))
  })
  if (live) throw new Error(`a holder is already listening on ${socketPath}`)
  fs.rmSync(socketPath, { force: true })
}

interface DispatchContext {
  table: PtyTable
  attach: (id: string) => Promise<Attachment>
}

async function dispatch(method: string, rawParams: unknown, ctx: DispatchContext): Promise<unknown> {
  const { table } = ctx
  switch (method as MethodName) {
    case METHODS.corePing: {
      const result: MethodMap['core.ping']['result'] = { protocolVersion: PROTOCOL_VERSION }
      return result
    }
    case METHODS.tabsCreate: {
      const p = params<MethodMap['tabs.create']['params']>(rawParams)
      const id = table.create({
        id: p.id,
        command: str(p.command, 'command'),
        args: p.args,
        cwd: str(p.cwd, 'cwd'),
        env: p.env,
        cols: num(p.cols, 'cols'),
        rows: num(p.rows, 'rows'),
      })
      return { id } satisfies MethodMap['tabs.create']['result']
    }
    case METHODS.tabsList:
      return (await table.listLive()) satisfies MethodMap['tabs.list']['result']
    case METHODS.tabsWrite: {
      const p = params<MethodMap['tabs.write']['params']>(rawParams)
      table.write(str(p.id, 'id'), b64ToBytes(str(p.dataB64, 'dataB64')).toString('utf8'))
      return {}
    }
    case METHODS.tabsResize: {
      const p = params<MethodMap['tabs.resize']['params']>(rawParams)
      table.resize(str(p.id, 'id'), num(p.cols, 'cols'), num(p.rows, 'rows'))
      return {}
    }
    case METHODS.tabsKill: {
      const p = params<MethodMap['tabs.kill']['params']>(rawParams)
      table.kill(str(p.id, 'id'))
      return {}
    }
    case METHODS.tabsAttach: {
      const p = params<MethodMap['tabs.attach']['params']>(rawParams)
      const attached = await ctx.attach(str(p.id, 'id'))
      return { screenB64: bytesToB64(Buffer.from(attached.screen)), cols: attached.cols, rows: attached.rows }
    }
    case METHODS.tabsScreen: {
      const p = params<MethodMap['tabs.screen']['params']>(rawParams)
      const text = await table.screen(str(p.id, 'id'))
      return { text } satisfies MethodMap['tabs.screen']['result']
    }
    default:
      throw new RpcError(ERROR_CODES.methodNotFound, `unknown method ${method}`)
  }
}

function params<P>(raw: unknown): P {
  if (typeof raw !== 'object' || raw === null) throw new RpcError(ERROR_CODES.invalidParams, 'params must be an object')
  return raw as P
}

function str(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new RpcError(ERROR_CODES.invalidParams, `${name} must be a string`)
  return value
}

function num(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new RpcError(ERROR_CODES.invalidParams, `${name} must be a positive integer`)
  }
  return value
}

function notification(method: string, params: unknown) {
  return { jsonrpc: '2.0', method, params }
}

function failure(id: JsonRpcId | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function toFailure(id: JsonRpcId, error: unknown) {
  if (error instanceof RpcError) return failure(id, error.code, error.message)
  if (error instanceof TabError) {
    return failure(id, ERROR_CODES[error.code], error.message)
  }
  const message = error instanceof Error ? error.message : String(error)
  return failure(id, ERROR_CODES.internal, message)
}
