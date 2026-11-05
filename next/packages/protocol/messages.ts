import type { AgentKind } from '../core/status/adapter.ts'

export const PROTOCOL_VERSION = 1

export const METHODS = {
  corePing: 'core.ping',
  tabsCreate: 'tabs.create',
  tabsList: 'tabs.list',
  tabsWrite: 'tabs.write',
  tabsResize: 'tabs.resize',
  tabsKill: 'tabs.kill',
  tabsAttach: 'tabs.attach',
  tabsOutput: 'tabs.output',
  tabsExit: 'tabs.exit',
  spacesList: 'spaces.list',
  spacesAdd: 'spaces.add',
  tabsOpen: 'tabs.open',
  tabsScreen: 'tabs.screen',
  agentsList: 'agents.list',
  attentionFocus: 'attention.focus',
  tabsClose: 'tabs.close',
  tabsRename: 'tabs.rename',
  tabsFocus: 'tabs.focus',
  configGet: 'config.get',
} as const

export const ERROR_CODES = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  tabNotFound: -32001,
  tabExists: -32002,
  stateRefused: -32003,
  agentMissing: -32004,
} as const

export type JsonRpcId = number | string

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

export interface JsonRpcFailure {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  error: { code: number; message: string }
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

export type Empty = Record<string, never>

export interface TabInfo {
  id: string
  command: string
  cwd: string
  alive: boolean
  exitCode: number | null
}

export interface SpaceInfo {
  // Opaque, and not a path. Spaces saved before ids existed have their path as their id.
  id: string
  path: string
  name: string
  repoName: string | null
  // The id of the space the worktree belongs to, or null.
  parent: string | null
  // The branch checked out in the space; null when detached or when git cannot say.
  branch: string | null
}

export interface SpaceTabInfo {
  id: string
  spaceId: string
  spacePath: string
  kind: 'terminal' | AgentKind
  label: string | null
  alive: boolean
  exitCode: number | null
}

export type AgentStateName = 'working' | 'needs-you' | 'finished' | 'idle' | 'unknown'

export type NeedsYouReason = 'permission' | 'question' | 'error'

export interface AgentInfo {
  tabId: string
  agent: AgentKind
  state: AgentStateName
  reason?: NeedsYouReason
  since: number
  source: string
  resumable: boolean
}

// A tab that needs the human: entered needs-you (any reason) or finished, and is not on screen.
export interface AttentionNotice {
  tabId: string
  state: 'needs-you' | 'finished'
  reason?: NeedsYouReason
}

// Keys of the key bindings in keys.json.
export type KeyAction = 'grid-toggle' | 'new-shell' | 'new-space' | 'close-tab'

export type LayoutSection = 'spaces' | 'agents'

// A shell line the window can start in the active space (launchers.json).
export interface Launcher {
  id: string
  label: string
  command: string
  args: string[]
  env: Record<string, string>
}

// The validated values of the five config files, one section each.
export interface ConfigValues {
  settings: { sidebarWidth: number }
  keys: Record<KeyAction, string>
  launchers: Launcher[]
  theme: Record<string, string>
  layout: { sidebarOrder: LayoutSection[] }
}

// The values in use, the config folder, and a note per file that does not validate (its last good values stay in use).
export interface ConfigSnapshot {
  path: string
  values: ConfigValues
  notes: Record<string, string>
}

export interface StatusChange {
  tabId: string
  agent: AgentKind
  state: AgentStateName
  reason?: NeedsYouReason
  since: number
  source: string
}

export interface MethodMap {
  'core.ping': { params: Empty; result: { protocolVersion: number } }
  'tabs.create': {
    params: {
      id?: string
      command: string
      args?: string[]
      cwd: string
      env?: Record<string, string>
      cols: number
      rows: number
      agent?: { kind: AgentKind; resumeId?: string }
      label?: string
    }
    result: { id: string }
  }
  'tabs.list': { params: Empty; result: TabInfo[] }
  'tabs.write': { params: { id: string; dataB64: string }; result: Empty }
  'tabs.resize': { params: { id: string; cols: number; rows: number }; result: Empty }
  'tabs.kill': { params: { id: string }; result: Empty }
  'tabs.attach': { params: { id: string }; result: { screenB64: string; cols: number; rows: number } }
  'spaces.list': {
    params: Empty
    result: { spaces: SpaceInfo[]; tabs: SpaceTabInfo[]; refused: string | null }
  }
  // Always adds a new space, even when the folder is already one.
  'spaces.add': { params: { path: string }; result: SpaceInfo }
  'tabs.open': { params: { spaceId: string; cols: number; rows: number; label?: string }; result: { id: string } }
  'tabs.screen': { params: { id: string }; result: { text: string } }
  'agents.list': { params: Empty; result: AgentInfo[] }
  // The tab on screen (null when none) and whether the window has focus.
  'attention.focus': { params: { tabId: string | null; windowFocused: boolean }; result: Empty }
  // Kills the tab in the holder and removes its saved record.
  'tabs.close': { params: { id: string }; result: Empty }
  // An empty label clears the name, so the tab shows its number again.
  'tabs.rename': { params: { id: string; label: string }; result: Empty }
  // Asks every client to show the tab; the window selects it and raises itself.
  'tabs.focus': { params: { id: string }; result: Empty }
  'config.get': { params: Empty; result: ConfigSnapshot }
}

export interface NotificationMap {
  'tabs.output': { id: string; dataB64: string }
  'tabs.exit': { id: string; exitCode: number | null }
  'status.changed': StatusChange
  'attention.notify': AttentionNotice
  'tabs.focus': { id: string }
  // A tab was closed on purpose: every window drops it.
  'tabs.closed': { id: string }
  // The config folder changed and a value or a note is new: every window applies it.
  'config.changed': ConfigSnapshot
}

export type MethodName = keyof MethodMap
