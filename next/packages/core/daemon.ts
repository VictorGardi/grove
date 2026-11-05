import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { connectRpc, type RpcClient } from '../protocol/client.ts'
import { bytesToB64, createLineDecoder, encodeLine } from '../protocol/framing.ts'
import { coreSocketPath, groveNextHome, holderSocketPath } from '../protocol/paths.ts'
import { ERROR_CODES, METHODS, PROTOCOL_VERSION } from '../protocol/messages.ts'
import type { IntegrationAgent, IntegrationInfo, KeyAction } from '../protocol/messages.ts'
import { claudeSettingsFile, copilotSettingsFile } from './integrations/install.ts'
import { IntegrationService, isIntegrationAgent } from './integrations/service.ts'
import { buildId } from './build.ts'
import { Presence } from './presence.ts'
import type { Empty, JsonRpcId, JsonRpcRequest, MethodMap, MethodName, NotificationMap } from '../protocol/messages.ts'
import { RpcError } from '../protocol/errors.ts'
import { SpacesService } from './spaces.ts'
import { recordSpaceId, tabSpaceId, type TabRecord } from './store/state.ts'
import { adapters as registry } from './agents/registry.ts'
import type { AgentAdapter, AgentKind, AgentLaunch } from './status/adapter.ts'
import { StatusService } from './status/service.ts'
import { Attention } from './attention/attention.ts'
import { ConfigStore, atomicWrite, configFolder } from './config/store.ts'
import { writeAgentsMd } from './config/agents-md.ts'
import { watchConfig } from './config/watch.ts'

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

// How often the presence scan looks at each tab's foreground program and folder.
const PRESENCE_MS = 1000

const SPACE_METHODS = new Set<string>([
  METHODS.spacesList,
  METHODS.spacesAdd,
  METHODS.spacesRemove,
  METHODS.spacesRename,
  METHODS.worktreesList,
  METHODS.worktreesAdd,
  METHODS.tabsOpen,
])

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
    integrations?: IntegrationService
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
  // Every tab gets the config folder in GROVE_NEXT_CONFIG. The core starts with the last good config and says so in AGENTS.md.
  const configDir = configFolder(home)
  const config = new ConfigStore(configDir)
  config.load()
  writeAgentsMd(configDir)

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
  // The hook entries Grove asks the human to enable, for Claude and Copilot. Only an install request writes them.
  const integrations =
    options.integrations ??
    new IntegrationService({
      files: { claude: claudeSettingsFile(), copilot: copilotSettingsFile() },
      consentFile: path.join(home, 'integrations.json'),
    })
  // Asked at most once per core run; a window that connects later reads the pending list instead.
  const asked = new Set<IntegrationAgent>()
  const offerIntegration = (kind: AgentKind): void => {
    if (!isIntegrationAgent(kind) || asked.has(kind)) return
    if (!integrations.status(kind, true).pending) return
    asked.add(kind)
    broadcast(notification('integration.prompt', { agent: kind }))
  }
  // Agents typed by hand: each tick finds the agent in each tab's foreground, adopts it, and applies the root rule.
  const presence = new Presence({
    clock: Date.now,
    tabs: async () =>
      (await holderStatusCall((client) => client.request(METHODS.tabsList, {}))).map((tab) => ({
        id: tab.id,
        alive: tab.alive,
        foreground: tab.foreground,
        argv0: tab.argv0,
        cwd: tab.cwd,
      })),
    spaceOf: (tabId) => spaces.spaceOfTab(tabId),
    agentRecorded: (tabId) => spaces.tabRecord(tabId)?.agent,
    setAgent: (tabId, kind) => spaces.setTabAgent(tabId, kind, true),
    setRoot: (spaceId, root) => {
      if (!spaces.setRoot(spaceId, root)) return
      void spaces
        .spaceInfo(spaceId)
        .then((info) => {
          if (info !== undefined) broadcast(notification('spaces.changed', info))
        })
        .catch((error: unknown) => console.error(`core: space change not announced: ${error instanceof Error ? error.message : String(error)}`))
    },
    adopt: (tabId, kind, sessionId) => {
      status.adopt({ tabId, kind, sessionId })
      offerIntegration(kind)
    },
    identify: (tabId, sessionId) => status.identify(tabId, sessionId),
    release: (tabId) => status.untrack(tabId),
    adoptedKind: (tabId) => status.adoptedKind(tabId),
    discover: async (kind, cwd, since) => adapters[kind]?.discover?.({ cwd, since }),
  })
  let presenceBusy = false
  const presenceTimer = setInterval(() => {
    if (presenceBusy) return
    presenceBusy = true
    presence
      .tick()
      .catch((error: unknown) => console.error(`core: presence scan failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        presenceBusy = false
      })
  }, PRESENCE_MS)

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
  // The client that last resized or attached each tab owns its size; a killed tab or a closed client drops its entry.
  const tabOwners = new Map<string, net.Socket>()
  const unsubscribe = status.subscribe((change) => {
    broadcast(notification('status.changed', change))
    attention.onStatus(change)
  })
  const unwatch = watchConfig(config, (snapshot) => broadcast(notification('config.changed', snapshot)))
  // Agent tabs are rebuilt before the core listens, so the first client already sees their state.
  status.restore(spaces.agentTabs(), aliveAtStart)
  status.start()
  const deps: Deps = { spaces, status, attention, home, configDir, config, adapters, available, broadcast, integrations }

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
        if (request.method === METHODS.tabsResize || request.method === METHODS.tabsAttach) {
          tabOwners.set((request.params as MethodMap['tabs.attach']['params']).id, socket)
        }
        if (request.method === METHODS.tabsKill || request.method === METHODS.tabsClose) {
          tabOwners.delete((request.params as MethodMap['tabs.kill']['params']).id)
        }
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
      for (const [tabId, owner] of tabOwners) if (owner === socket) tabOwners.delete(tabId)
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
        unwatch()
        clearInterval(presenceTimer)
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
  configDir: string
  config: ConfigStore
  adapters: Partial<Record<AgentKind, AgentAdapter>>
  available: Set<AgentKind>
  broadcast: (message: unknown) => void
  integrations: IntegrationService
}

// The agent kinds of the tabs the app did not start that are running now.
function adoptedAgentsOf(status: StatusService): Set<AgentKind> {
  return new Set(status.list(new Set()).filter((agent) => status.adoptedKind(agent.tabId) === agent.agent).map((agent) => agent.agent))
}

function integrationAgentParam(params: unknown): IntegrationAgent {
  const agent = (params as { agent?: unknown } | null)?.agent
  if (!isIntegrationAgent(agent)) throw new RpcError(ERROR_CODES.invalidParams, 'agent must be claude or copilot')
  return agent
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
  if (method === METHODS.tabsClose) {
    return closeTab(rawParams, await holder, deps)
  }
  if (method === METHODS.tabsFocus) {
    return focusTab(rawParams, await holder, deps)
  }
  if (method === METHODS.tabsRename) {
    return renameTab(rawParams, deps)
  }
  if (method === METHODS.notesRead) {
    return readNotes(deps.home) satisfies MethodMap['notes.read']['result']
  }
  if (method === METHODS.notesWrite) {
    atomicWrite(notesFile(deps.home), stringParam(rawParams, 'text'))
    return {} satisfies MethodMap['notes.write']['result']
  }
  if (method === METHODS.configGet) {
    return deps.config.snapshot() satisfies MethodMap['config.get']['result']
  }
  if (method === METHODS.configSetKey) {
    const action = stringParam(rawParams, 'action') as KeyAction
    try {
      deps.config.setKey(action, stringParam(rawParams, 'binding'))
    } catch (error) {
      if (error instanceof RpcError) throw error
      throw new RpcError(ERROR_CODES.invalidParams, (error as Error).message)
    }
    const snapshot = deps.config.snapshot()
    deps.broadcast(notification('config.changed', snapshot))
    return snapshot satisfies MethodMap['config.setKey']['result']
  }
  if (method === METHODS.integrationStatus) {
    const running = adoptedAgentsOf(deps.status)
    const agents: IntegrationInfo[] = (['claude', 'copilot'] as const).map((agent) => deps.integrations.status(agent, running.has(agent)))
    return { agents } satisfies MethodMap['integration.status']['result']
  }
  if (method === METHODS.integrationInstall) {
    const agent = integrationAgentParam(rawParams)
    return deps.integrations.install(agent, adoptedAgentsOf(deps.status).has(agent)) satisfies MethodMap['integration.install']['result']
  }
  if (method === METHODS.integrationUninstall) {
    const agent = integrationAgentParam(rawParams)
    return deps.integrations.uninstall(agent, adoptedAgentsOf(deps.status).has(agent)) satisfies MethodMap['integration.uninstall']['result']
  }
  if (method === METHODS.integrationAnswer) {
    const agent = integrationAgentParam(rawParams)
    if ((rawParams as { answer?: unknown }).answer !== 'not-now') throw new RpcError(ERROR_CODES.invalidParams, 'answer must be not-now')
    deps.integrations.answer(agent, 'not-now')
    return {} satisfies MethodMap['integration.answer']['result']
  }
  if (method === METHODS.corePing) {
    const result: MethodMap['core.ping']['result'] = { protocolVersion: PROTOCOL_VERSION, build: buildId() }
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
  if (SPACE_METHODS.has(method)) return dispatchSpaces(method, rawParams, await holder, deps)
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
  const labelParam = optionalLabel(p)
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
  // A resume keeps the space it was saved in; a new tab goes in the space it names, else in the first space of the folder it names.
  const folder = saved?.spacePath ?? stringParam(p, 'cwd')
  const space =
    saved !== undefined
      ? deps.spaces.spaceById(tabSpaceId(saved))
      : p.spaceId !== undefined
        ? deps.spaces.spaceById(p.spaceId)
        : deps.spaces.firstSpaceAt(folder)
  if (space === undefined) throw new RpcError(ERROR_CODES.invalidParams, p.spaceId !== undefined && saved === undefined ? `no such space: ${p.spaceId}` : `not a space: ${folder}`)
  const spaceId = recordSpaceId(space)
  const spacePath = space.path
  // A resume keeps the label it was saved with.
  const label = saved?.label ?? labelParam

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
  const record: TabRecord = { id, spaceId, spacePath, agent: kind, agentSessionId: launch.sessionId }
  deps.spaces.saveAgentTab(label === undefined ? record : { ...record, label })
  await holder.request(METHODS.tabsCreate, {
    id,
    command: launch.command,
    args: launch.args,
    env: { ...launch.env, GROVE_NEXT_CONFIG: deps.configDir, GROVE_NEXT_TAB: id, GROVE_NEXT_HOME: deps.home },
    cwd: spacePath,
    cols: numberParam(p, 'cols'),
    rows: numberParam(p, 'rows'),
  })
  deps.status.track({ tabId: id, spaceId, spacePath, kind, sessionId: launch.sessionId })
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

// Kills the tab in the holder, then drops its record and its status. An id that is neither saved nor in the holder is refused.
async function closeTab(rawParams: unknown, holder: RpcClient, deps: Deps): Promise<Empty> {
  const id = tabIdParam(rawParams)
  deps.spaces.assertNotRefused()
  const saved = deps.spaces.tabRecord(id) !== undefined
  const live = (await holder.request(METHODS.tabsList, {})).some((tab) => tab.id === id)
  if (!saved && !live) throw new RpcError(ERROR_CODES.invalidParams, `no such tab: ${id}`)
  if (live) await holder.request(METHODS.tabsKill, { id })
  deps.spaces.removeTab(id)
  deps.status.untrack(id)
  const params: NotificationMap['tabs.closed'] = { id }
  deps.broadcast(notification('tabs.closed', params))
  return {} satisfies MethodMap['tabs.close']['result']
}

// Sets a saved tab's label. Only the saved record changes, so nothing is broadcast: the window updates itself.
function renameTab(rawParams: unknown, deps: Deps): Empty {
  const id = tabIdParam(rawParams)
  deps.spaces.rename(id, stringParam(rawParams, 'label'))
  return {} satisfies MethodMap['tabs.rename']['result']
}

// Tells every connected window to show the tab. The tab must be saved or live in the holder.
async function focusTab(rawParams: unknown, holder: RpcClient, deps: Deps): Promise<Empty> {
  const id = tabIdParam(rawParams)
  const saved = deps.spaces.tabRecord(id) !== undefined
  const live = (await holder.request(METHODS.tabsList, {})).some((tab) => tab.id === id)
  if (!saved && !live) throw new RpcError(ERROR_CODES.invalidParams, `no such tab: ${id}`)
  const params: NotificationMap['tabs.focus'] = { id }
  deps.broadcast(notification('tabs.focus', params))
  return {} satisfies MethodMap['tabs.focus']['result']
}

function tabIdParam(params: unknown): string {
  const id = (params as Record<string, unknown> | null)?.id
  if (typeof id !== 'string' || !TAB_ID.test(id)) throw new RpcError(ERROR_CODES.invalidParams, 'tab id is not valid')
  return id
}

async function dispatchSpaces(method: string, rawParams: unknown, holder: RpcClient, deps: Deps): Promise<unknown> {
  const { spaces } = deps
  if (method === METHODS.spacesList) return spaces.list(holder)
  if (method === METHODS.spacesAdd) {
    const p = rawParams as MethodMap['spaces.add']['params']
    return spaces.add(stringParam(p, 'path'))
  }
  if (method === METHODS.spacesRemove) return removeSpace(rawParams, holder, deps)
  if (method === METHODS.spacesRename) {
    spaces.renameSpace(stringParam(rawParams, 'id'), stringParam(rawParams, 'name'))
    return {} satisfies MethodMap['spaces.rename']['result']
  }
  if (method === METHODS.worktreesList) {
    return { worktrees: await spaces.unopenedWorktrees(stringParam(rawParams, 'spaceId')) } satisfies MethodMap['worktrees.list']['result']
  }
  if (method === METHODS.worktreesAdd) {
    return spaces.addWorktreeSpace(stringParam(rawParams, 'spaceId'), stringParam(rawParams, 'branch'))
  }
  const p = rawParams as MethodMap['tabs.open']['params']
  const env = { GROVE_NEXT_CONFIG: deps.configDir }
  return spaces.openTab(stringParam(p, 'spaceId'), numberParam(p, 'cols'), numberParam(p, 'rows'), holder, optionalLabel(p), env)
}

// Closes every tab of the space, then drops the space. With removeWorktree the checkout goes first, so a refusal by git
// (changes in it) leaves the space and its tabs as they were.
async function removeSpace(rawParams: unknown, holder: RpcClient, deps: Deps): Promise<Empty> {
  const id = stringParam(rawParams, 'id')
  const removeWorktree = (rawParams as Record<string, unknown>).removeWorktree === true
  deps.spaces.assertNotRefused()
  if (!deps.spaces.isSpace(id)) throw new RpcError(ERROR_CODES.invalidParams, `no such space: ${id}`)
  if (removeWorktree) await deps.spaces.removeWorktreeFolder(id)
  for (const tabId of deps.spaces.tabIdsOf(id)) await closeTab({ id: tabId }, holder, deps)
  deps.spaces.removeSpace(id)
  const params: NotificationMap['spaces.removed'] = { id }
  deps.broadcast(notification('spaces.removed', params))
  return {} satisfies MethodMap['spaces.remove']['result']
}

const notesFile = (home: string): string => path.join(home, 'notes.md')

function readNotes(home: string): { text: string } {
  try {
    return { text: fs.readFileSync(notesFile(home), 'utf8') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '' }
    throw error
  }
}

function stringParam(params: unknown, key: string): string {
  const value = (params as Record<string, unknown> | null)?.[key]
  if (typeof value !== 'string') throw new RpcError(ERROR_CODES.invalidParams, `${key} must be a string`)
  return value
}

// A label is optional; when given it is a non-empty string.
function optionalLabel(params: unknown): string | undefined {
  const value = (params as Record<string, unknown> | null)?.label
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value === '') throw new RpcError(ERROR_CODES.invalidParams, 'label must be a non-empty string')
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
