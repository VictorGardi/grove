import type { Project, Session, SessionKind, Slices, UiState } from './types'

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }
export type MenuAction =
  | { type: 'newSession' } | { type: 'closeSession' } | { type: 'focusIndex'; n: number }
// invoke channels: name → [args, result data]
export interface InvokeMap {
  'state:get': [void, Slices]
  'app:errors': [void, string[]]
  'project:add': [void, Project | null]
  'project:remove': [{ id: string }, { id: string }]
  'session:create': [{ projectId: string; kind: SessionKind; cols: number; rows: number }, Session]
  'session:kill': [{ id: string }, { id: string }]
  'session:remove': [{ id: string }, { id: string }]
  'session:rename': [{ id: string; label: string }, Session]
  'ui:set': [Partial<UiState>, UiState]
  'pty:attach': [{ sessionId: string; cols: number; rows: number }, { attachId: string }]
}
// fire-and-forget renderer → main
export interface SendMap {
  'pty:input': { attachId: string; data: string }
  'pty:resize': { attachId: string; cols: number; rows: number }
  'pty:detach': { attachId: string }
}
// pushes main → renderer
export interface PushMap {
  'state:projects': Project[]
  'state:sessions': Session[]
  'state:ui': UiState
  'pty:data': { attachId: string; data: string }
  'pty:exit': { attachId: string }
  'menu:action': MenuAction
}
export interface Api {
  invoke<K extends keyof InvokeMap>(ch: K, ...args: InvokeMap[K][0] extends void ? [] : [InvokeMap[K][0]]): Promise<Result<InvokeMap[K][1]>>
  send<K extends keyof SendMap>(ch: K, payload: SendMap[K]): void
  on<K extends keyof PushMap>(ch: K, cb: (payload: PushMap[K]) => void): () => void
}
