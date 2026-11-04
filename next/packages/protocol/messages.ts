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
} as const

export const ERROR_CODES = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  tabNotFound: -32001,
  tabExists: -32002,
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
    }
    result: { id: string }
  }
  'tabs.list': { params: Empty; result: TabInfo[] }
  'tabs.write': { params: { id: string; dataB64: string }; result: Empty }
  'tabs.resize': { params: { id: string; cols: number; rows: number }; result: Empty }
  'tabs.kill': { params: { id: string }; result: Empty }
  'tabs.attach': { params: { id: string }; result: { screenB64: string; cols: number; rows: number } }
}

export interface NotificationMap {
  'tabs.output': { id: string; dataB64: string }
  'tabs.exit': { id: string; exitCode: number | null }
}

export type MethodName = keyof MethodMap
