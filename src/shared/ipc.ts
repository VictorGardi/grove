import type { FeaturesSlice, OpenCodeSlice, Project, Session, SessionKind, Slices, UiState } from './types'

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }
export type MenuAction =
  | { type: 'newSession' } | { type: 'closeSession' } | { type: 'focusIndex'; n: number } | { type: 'projectBoard' }
// invoke channels: name → [args, result data]
export interface InvokeMap {
  'state:get': [void, Slices]
  'app:errors': [void, string[]]
  'project:add': [void, Project | null]
  'project:remove': [{ id: string }, { id: string }]
  'session:create': [{ projectId: string; kind: SessionKind; cols: number; rows: number }, Session]
  'session:kill': [{ id: string }, { id: string }]
  'session:remove': [{ id: string }, { id: string }]
  'session:resume': [{ id: string }, Session]
  'session:rename': [{ id: string; label: string }, Session]
  'session:link': [{ id: string; feature: string | null }, Session]
  'ui:set': [Partial<UiState>, UiState]
  'viewer:reload': [void, void]
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
  'state:features': FeaturesSlice
  'state:opencode': OpenCodeSlice
  'pty:data': { attachId: string; data: string }
  'pty:exit': { attachId: string }
  'menu:action': MenuAction
}
export interface Api {
  invoke<K extends keyof InvokeMap>(ch: K, ...args: InvokeMap[K][0] extends void ? [] : [InvokeMap[K][0]]): Promise<Result<InvokeMap[K][1]>>
  send<K extends keyof SendMap>(ch: K, payload: SendMap[K]): void
  on<K extends keyof PushMap>(ch: K, cb: (payload: PushMap[K]) => void): () => void
}
