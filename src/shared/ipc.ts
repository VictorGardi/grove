import type { Comment, CommentAnchor, FeatureKey, FeaturesSlice, OpenCodeSlice, Project, Session, SessionDiff, SessionKind, Slices, UiState, WorkflowStatus } from './types'

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; detail?: string }
export type MenuAction =
  | { type: 'newSession' } | { type: 'newSessionOptions' } | { type: 'closeSession' } | { type: 'focusIndex'; n: number } | { type: 'projectBoard' } | { type: 'artifactsBoard' }
  | { type: 'sessionDiff' } | { type: 'toggleSidebar' } | { type: 'addToGrid' }
  | { type: 'newTerminal' } | { type: 'lastSession' } | { type: 'palette' } | { type: 'toggleGrid' } | { type: 'clearGrid' }
  | { type: 'scratchpad' } | { type: 'nextWaiting' } | { type: 'familyJump' }
// invoke channels: name → [args, result data]
export interface InvokeMap {
  'state:get': [void, Slices]
  'app:errors': [void, string[]]
  'project:add': [void, Project | null]
  'project:remove': [{ id: string }, { id: string }]
  'worktree:create': [{ projectId: string; branch: string; base?: string }, Project]
  'worktree:remove': [{ projectId: string; force?: boolean; endSessions?: boolean }, { id: string }]
  'repo:refs': [{ projectId: string }, { branch: string | null; default: string | null; bases: string[] }]
  // what the core command already accepts: until the launch dialog existed the renderer could send
  // only projectId and kind, so the GUI could not reach the fields the CLI always could
  'session:create': [{ projectId: string; worktree?: { branch: string; base?: string }; kind: SessionKind; prompt?: string; label?: string; feature?: string; cols: number; rows: number }, Session]
  'session:remove': [{ id: string }, { id: string }]
  'session:dismissStartup': [{ id: string }, { id: string }]
  'session:resume': [{ id: string }, Session]
  'session:rename': [{ id: string; label: string }, Session]
  'session:link': [{ id: string; feature: string | null }, Session]
  'session:setParent': [{ id: string; parent: string | null }, Session]
  'session:workflowStatus': [{ id: string; status: WorkflowStatus }, Session]
  'comment:add': [{ sessionId: string | null; feature?: FeatureKey; anchor: CommentAnchor; body: string }, Comment]
  'comment:update': [{ id: string; body: string }, Comment]
  'comment:delete': [{ id: string }, { id: string }]
  'review:send': [{ sessionId: string; feature?: FeatureKey }, { sent: number }]
  'review:start-and-send': [{ feature: FeatureKey; kind: SessionKind; cols: number; rows: number }, { sessionId: string; sent: number }]
  'diff:lines': [{ sessionId: string; path: string; from: number; to: number }, string[]]
  'diff:refs': [{ sessionId: string }, { branches: string[]; current: string | null; default: string | null }]
  'ui:set': [Partial<UiState>, UiState]
  'session:focusLast': [void, { id: string }]
  'viewer:reload': [void, void]
  'pty:attach': [{ sessionId: string; cols: number; rows: number }, { attachId: string }]
  'notes:read': [{ sessionId?: string } | void, string]
  'notes:write': [{ content: string; sessionId?: string }, void]
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
  'state:diff': SessionDiff | null
  'state:comments': Comment[]
  'pty:data': { attachId: string; data: string }
  'pty:exit': { attachId: string }
  'menu:action': MenuAction
}
export interface Api {
  invoke<K extends keyof InvokeMap>(ch: K, ...args: InvokeMap[K][0] extends void ? [] : [InvokeMap[K][0]]): Promise<Result<InvokeMap[K][1]>>
  send<K extends keyof SendMap>(ch: K, payload: SendMap[K]): void
  on<K extends keyof PushMap>(ch: K, cb: (payload: PushMap[K]) => void): () => void
}
