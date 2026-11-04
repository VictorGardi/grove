import { randomUUID } from 'node:crypto'
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
import { adapters as registry } from './agents/registry.ts'
import type { AgentAdapter, AgentKind, AgentLaunch } from './status/adapter.ts'
import { StatusService } from './status/service.ts'
import { Attention } from './attention/attention.ts'

const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/
// A holder call the status service makes must answer within this, or that call fails and its check is skipped.
const STATUS_CALL_MS = 2000

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
  METHODS.tabsScreen,
])

const SPACE_METHODS = new Set<string>([METHODS.spacesList, METHODS.spacesAdd, METHODS.tabsOpen])

// Each core client gets its own holder connection, so holder attachments are released
// when the client's connection closes and output is never shared between clients.
export async function startCoreDaemon(
  options: {
    socketPath?: string
    holderSocket?: string
    stateFile?: string
    spaces?: SpacesService
    home?: string
    adapters?: Partial<Record<AgentKind, AgentAdapter>>
    status?: StatusService
  } = {},
): Promise<CoreServer> {
  const socketPath = options.socketPath ?? coreSocketPath()
  const holderSocket = options.holderSocket ?? holderSocketPath()
  const home = options.home ?? groveNextHome()
  const adapters = options.adapters ?? registry
  // An agent that reported its command available is not probed again for the life of this core.
  const available = new Set<AgentKind>()
  const spaces = options.spaces ?? new SpacesService(options.stateFile ?? path.join(home, 'state.json'))
  await removeStaleSocket(socketPath)

  // The status service reads screens and tab liveness through its own holder connection, so it does not depend on any window.
  let statusClient: Promise<RpcClient> | undefined
  const holderStatusCall = async <T>(use: (client: RpcClient) => Promise<T>): Promise<T> => {
    const pending = (statusClient ??= connectRpc(holderSocket))
    try {
      return await withTimeout(pending.then(use), STATUS_CALL_MS)
    } catch (error) {
      if (statusClient === pending) statusClient = undefined
      void pending.then(
        (client) => client.close(),
        () => undefined,
      )
      throw error
    }
  }
  const screen = (tabId: string): Promise<string> =>
    holderStatusCall(async (client) => (await client.request(METHODS.tabsScreen, { id: tabId })).text)
  const alive = (): Promise<Set<string>> =>
    holderStatusCall(async (client) => aliveIds(await client.request(METHODS.tabsList, {})))
  const status =
    options.status ??
    new StatusService({
      home,
      adapters,
      screen,
      alive,
      onSession: (tabId, sessionId) => spaces.setAgentSession(tabId, sessionId),
    })
  // A holder that cannot be reached at start leaves every saved agent tab unknown.
  const aliveAtStart = await alive().catch(() => new Set<string>())

  const sockets = new Set<net.Socket>()
  const broadcast = (message: unknown) => {
    for (const socket of sockets) if (!socket.destroyed) socket.write(encodeLine(message))
  }
  const attention = new Attention({
    notify: (notice) => broadcast(notification('attention.notify', notice)),
    markSeen: (tabId) => status.markSeen(tabId),
  })
  // The client that last sent attention.focus; when its connection closes the window is no longer focused.
  let focusOwner: net.Socket | undefined
  const unsubscribe = status.subscribe((change) => {
    broadcast(notification('status.changed', change))
    attention.onStatus(change)
  })
  // Agent tabs are rebuilt before the core listens, so the first client already sees their state.
  status.restore(spaces.agentTabs(), aliveAtStart)
  status.start()
  const deps: Deps = { spaces, status, attention, home, adapters, available }

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
        const result = await dispatch(request.method, request.params, holder, deps)
        if (request.method === METHODS.attentionFocus) focusOwner = socket
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
      if (focusOwner === socket) {
        focusOwner = undefined
        attention.focus(null, false)
      }
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
        unsubscribe()
        status.close()
        void statusClient?.then(
          (client) => client.close(),
          () => undefined,
        )
        for (const socket of sockets) socket.destroy()
        server.close(() => {
          fs.rmSync(socketPath, { force: true })
          resolve()
        })
      }),
  }
}

function aliveIds(tabs: Array<{ id: string; alive: boolean }>): Set<string> {
  return new Set(tabs.filter((tab) => tab.alive).map((tab) => tab.id))
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the holder did not answer in time')), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
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

interface Deps {
  spaces: SpacesService
  status: StatusService
  attention: Attention
  home: string
  adapters: Partial<Record<AgentKind, AgentAdapter>>
  available: Set<AgentKind>
}

async function dispatch(method: string, rawParams: unknown, holder: Promise<RpcClient>, deps: Deps): Promise<unknown> {
  if (method === METHODS.attentionFocus) {
    const p = rawParams as MethodMap['attention.focus']['params']
    if (p?.tabId !== null && (typeof p?.tabId !== 'string' || !TAB_ID.test(p.tabId))) {
      throw new RpcError(ERROR_CODES.invalidParams, 'tab id is not valid')
    }
    if (typeof p?.windowFocused !== 'boolean') throw new RpcError(ERROR_CODES.invalidParams, 'windowFocused must be a boolean')
    deps.attention.focus(p.tabId, p.windowFocused)
    return {} satisfies MethodMap['attention.focus']['result']
  }
  if (method === METHODS.corePing) {
    const result: MethodMap['core.ping']['result'] = { protocolVersion: PROTOCOL_VERSION }
    return result
  }
  if (method === METHODS.agentsList) {
    const client = await holder
    const alive = aliveIds(await client.request(METHODS.tabsList, {}))
    return deps.status.list(alive) satisfies MethodMap['agents.list']['result']
  }
  if (method === METHODS.tabsCreate && agentParam(rawParams) !== undefined) {
    return createAgentTab(rawParams as MethodMap['tabs.create']['params'], await holder, deps)
  }
  if (SPACE_METHODS.has(method)) return dispatchSpaces(method, rawParams, await holder, deps.spaces)
  if (!PROXIED.has(method)) throw new RpcError(ERROR_CODES.methodNotFound, `unknown method ${method}`)
  const client = await holder
  return client.request(method as MethodName, rawParams as never)
}

function agentParam(params: unknown): unknown {
  return (params as Record<string, unknown> | null)?.agent
}

// Starts an agent tab in a space. With an id and a saved record it is a resume: same tab id, and the
// saved session id unless the caller gives one.
async function createAgentTab(
  p: MethodMap['tabs.create']['params'],
  holder: RpcClient,
  deps: Deps,
): Promise<{ id: string }> {
  const kind = p.agent?.kind
  const adapter = kind === undefined ? undefined : deps.adapters[kind]
  if (kind === undefined || adapter === undefined) {
    const known = Object.keys(deps.adapters).join(', ')
    throw new RpcError(ERROR_CODES.invalidParams, `agent.kind must be one of ${known}`)
  }
  if (p.id !== undefined && !TAB_ID.test(p.id)) throw new RpcError(ERROR_CODES.invalidParams, 'tab id is not valid')
  // Before the lookup: a refused state must not even start a tab in the holder.
  deps.spaces.assertNotRefused()
  const id = p.id ?? randomUUID().slice(0, 8)
  const saved = deps.spaces.tabRecord(id)
  if (saved !== undefined && saved.agent === undefined) {
    throw new RpcError(ERROR_CODES.tabExists, `tab ${id} is a shell tab`)
  }
  if (saved !== undefined && saved.agent !== kind) {
    throw new RpcError(ERROR_CODES.invalidParams, `tab ${id} is a ${saved.agent} tab`)
  }
  const spacePath = saved?.spacePath ?? stringParam(p, 'cwd')
  if (!deps.spaces.isSpace(spacePath)) throw new RpcError(ERROR_CODES.invalidParams, `not a space: ${spacePath}`)

  // A command that is not on the login shell's PATH is refused before anything is written for it.
  if (adapter.available !== undefined && !deps.available.has(kind)) {
    if (!(await adapter.available())) {
      throw new RpcError(ERROR_CODES.agentMissing, `${kind} is not on the PATH of your login shell`)
    }
    deps.available.add(kind)
  }

  const resumeId = p.agent?.resumeId ?? saved?.agentSessionId
  let launch: AgentLaunch
  try {
    launch = adapter.launch({ tabId: id, cwd: spacePath, home: deps.home, resumeId })
  } catch (error) {
    throw new RpcError(ERROR_CODES.invalidParams, error instanceof Error ? error.message : String(error))
  }
  if (p.id !== undefined) await removeExitedTab(holder, id)
  // Saved before the holder create: if the create fails, the record stays and the tab can be resumed.
  deps.spaces.saveAgentTab({ id, spacePath, agent: kind, agentSessionId: launch.sessionId })
  await holder.request(METHODS.tabsCreate, {
    id,
    command: launch.command,
    args: launch.args,
    env: launch.env,
    cwd: spacePath,
    cols: numberParam(p, 'cols'),
    rows: numberParam(p, 'rows'),
  })
  deps.status.track({ tabId: id, spacePath, kind, sessionId: launch.sessionId })
  return { id }
}

// An agent tab that exits on its own (/exit, a crash, kill -9 of Claude) stays in the holder as an exited
// entry, and a create with the same id would fail with tabExists. An exited entry is removed first. A live
// one is left alone, so the create refuses it as before.
async function removeExitedTab(holder: RpcClient, id: string): Promise<void> {
  const tabs = await holder.request(METHODS.tabsList, {})
  if (!tabs.some((tab) => tab.id === id && !tab.alive)) return
  try {
    await holder.request(METHODS.tabsKill, { id })
  } catch (error) {
    // The client does not carry the error code, so a kill that fails because the entry is already gone is told apart by asking again.
    const stillThere = (await holder.request(METHODS.tabsList, {})).some((tab) => tab.id === id)
    if (stillThere) throw error
  }
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
