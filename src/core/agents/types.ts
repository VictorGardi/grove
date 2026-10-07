import type { SessionKind } from '@shared/types'

// Agent-neutral events and the adapter seam (ADR 0019). Each agent's own shapes stay in its adapter.
export type AgentEvent =
  | { type: 'connected'; version: string }
  | { type: 'disconnected' }
  | { type: 'exec-started'; sessionId: string }
  | { type: 'exec-ended'; sessionId: string; at: string } // succeeded | failed | interrupted
  | { type: 'pending'; sessionId: string; id: string; kind: 'permission' | 'question'; open: boolean }
  | { type: 'child'; sessionId: string; parentId: string } // a subagent session and its parent
  | { type: 'wrote'; sessionId: string; paths: string[] } // a write/edit/patch succeeded; raw paths

// A session's state as read on (re)connect; pending items are its own, children listed separately.
export interface SessionSnapshot {
  running: boolean
  idleAt: string | null
  pending: { id: string; kind: 'permission' | 'question' }[]
  children: string[]
}

export type AgentKind = Exclude<SessionKind, 'terminal'>

// One per agent kind. Each source owns its kind's id format, argv and files.
export interface AgentSource {
  kind: AgentKind
  statusNeedsEvent: boolean // no status for a session until the source has seen an event for it
  mintId(now: Date): string
  argv(id: string, mode: 'start' | 'resume', opts?: { prompt?: string; name?: string }): string[] // before loginShellArgv; opts only on start
  start(onEvent: (e: AgentEvent) => void): void // connects and reconnects until stop()
  snapshot(ids: string[]): Promise<Map<string, SessionSnapshot>> // ids and their children
  lastWrites(id: string): Promise<string[]> // paths of the session's latest successful write; [] if none
  forget(id: string): void // the session was removed
  stop(): void
}
