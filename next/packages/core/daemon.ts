import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { connectRpc, type RpcClient } from '../protocol/client.ts'
import { bytesToB64, createLineDecoder, encodeLine } from '../protocol/framing.ts'
import { coreSocketPath, groveNextHome, holderSocketPath } from '../protocol/paths.ts'
import { ERROR_CODES, METHODS, PROTOCOL_VERSION } from '../protocol/messages.ts'
import type { JsonRpcId, JsonRpcRequest, MethodMap, MethodName } from '../protocol/messages.ts'
import { RpcError } from '../protocol/errors.ts'
import { SpacesService } from './spaces.ts'

export interface CoreServer {
  socketPath: string
  close: () => Promise<void>
}

const PROXIED = new Set<string>([
  METHODS.tabsCreate,
  METHODS.tabsList,
  METHODS.tabsWrite,
  METHODS.tabsResize,
  METHODS.tabsKill,
  METHODS.tabsAttach,
])

const SPACE_METHODS = new Set<string>([METHODS.spacesList, METHODS.spacesAdd, METHODS.tabsOpen])

// Each core client gets its own holder connection, so holder attachments are released
// when the client's connection closes and output is never shared between clients.
export async function startCoreDaemon(
  options: { socketPath?: string; holderSocket?: string; stateFile?: string; spaces?: SpacesService } = {},
): Promise<CoreServer> {
  const socketPath = options.socketPath ?? coreSocketPath()
  const holderSocket = options.holderSocket ?? holderSocketPath()
  const spaces = options.spaces ?? new SpacesService(options.stateFile ?? path.join(groveNextHome(), 'state.json'))
  await removeStaleSocket(socketPath)

  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    const send = (message: unknown) => {
      if (!socket.destroyed) socket.write(encodeLine(message))
    }
    const holder: Promise<RpcClient> = connectRpc(holderSocket).then((client) => {
      client.onNotification(METHODS.tabsOutput, (params) => send(notification(METHODS.tabsOutput, params)))
      client.onNotification(METHODS.tabsExit, (params) => send(notification(METHODS.tabsExit, params)))
      return client
    })
    holder.catch(() => undefined)

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
      try {
        const result = await dispatch(request.method, request.params, holder, spaces)
        if (request.id !== undefined) send({ jsonrpc: '2.0', id: request.id, result })
      } catch (error) {
        if (request.id !== undefined) send(toFailure(request.id, error))
      }
    }
    const decode = createLineDecoder((line) => void handleLine(line))
    socket.on('data', decode)
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      sockets.delete(socket)
      void holder.then(
        (client) => client.close(),
        () => undefined,
      )
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
  const live = await connectRpc(socketPath).then(
    (client) => {
      client.close()
      return true
    },
    () => false,
  )
  if (live) throw new Error(`a core is already listening on ${socketPath}`)
  fs.rmSync(socketPath, { force: true })
}

async function dispatch(
  method: string,
  rawParams: unknown,
  holder: Promise<RpcClient>,
  spaces: SpacesService,
): Promise<unknown> {
  if (method === METHODS.corePing) {
    const result: MethodMap['core.ping']['result'] = { protocolVersion: PROTOCOL_VERSION }
    return result
  }
  if (SPACE_METHODS.has(method)) return dispatchSpaces(method, rawParams, await holder, spaces)
  if (!PROXIED.has(method)) throw new RpcError(ERROR_CODES.methodNotFound, `unknown method ${method}`)
  const client = await holder
  return client.request(method as MethodName, rawParams as never)
}

async function dispatchSpaces(
  method: string,
  rawParams: unknown,
  holder: RpcClient,
  spaces: SpacesService,
): Promise<unknown> {
  if (method === METHODS.spacesList) return spaces.list(holder)
  if (method === METHODS.spacesAdd) {
    const p = rawParams as MethodMap['spaces.add']['params']
    return spaces.add(stringParam(p, 'path'))
  }
  const p = rawParams as MethodMap['tabs.open']['params']
  return spaces.openTab(stringParam(p, 'spacePath'), numberParam(p, 'cols'), numberParam(p, 'rows'), holder)
}

function stringParam(params: unknown, key: string): string {
  const value = (params as Record<string, unknown> | null)?.[key]
  if (typeof value !== 'string') throw new RpcError(ERROR_CODES.invalidParams, `${key} must be a string`)
  return value
}

function numberParam(params: unknown, key: string): number {
  const value = (params as Record<string, unknown> | null)?.[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RpcError(ERROR_CODES.invalidParams, `${key} must be a number`)
  }
  return value
}

function notification(method: string, params: unknown) {
  return { jsonrpc: '2.0', method, params }
}

function failure(id: JsonRpcId | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

// Holder errors arrive as plain Error messages, so they reach the client as internal errors.
function toFailure(id: JsonRpcId, error: unknown) {
  if (error instanceof RpcError) return failure(id, error.code, error.message)
  const message = error instanceof Error ? error.message : String(error)
  return failure(id, ERROR_CODES.internal, message)
}
