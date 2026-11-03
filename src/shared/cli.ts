import type { Session, SessionKind, WorkflowStatus } from './types'

// The grove CLI's wire protocol (ADR 0027): one JSON line per connection, over a Unix socket.
export const PROTOCOL = 1

export interface CliMethods {
  'sessions.list': { params: { all?: boolean }; data: CliSession[] }
  'sessions.create': {
    params: { kind: SessionKind; cwd: string; prompt?: string; label?: string; feature?: string; parent?: string; relation?: 'slice'; worktree?: boolean; branch?: string; base?: string; model?: string; wait?: boolean; timeoutS?: number }
    data: CliSession & { turn?: TurnResult }
  }
  'sessions.send': { params: { ref: string; text: string; submit: boolean; wait?: boolean; timeoutS?: number }; data: { id: string; turn?: TurnResult } }
  'sessions.wait': { params: { ref: string; timeoutS?: number }; data: { id: string } & TurnResult }
  'sessions.focus': { params: { ref: string }; data: { id: string } }
  'sessions.kill': { params: { ref: string }; data: { id: string } }
  'sessions.status': { params: { ref: string; status: WorkflowStatus }; data: { id: string } }
  'sessions.progress': { params: { ref: string; done: number; total: number }; data: { id: string } }
  'sessions.read': { params: { ref: string; lines: number }; data: { text: string } }
}

// How a wait ended: The CLI exits 0 (idle), 5 (gone).
export interface TurnResult {
  status: 'idle' | 'gone'
  waitingFor: Session['waitingFor'] | null
}

// The workflow statuses `grove status` accepts; the CLI spells them as the app stores them.
export const WORKFLOW_STATUS_VALUES: WorkflowStatus[] = ['backlog', 'in-progress', 'blocked', 'in-review', 'cancelled', 'done', 'pinned']

export interface CliRequest {
  v: 1
  id: string
  method: keyof CliMethods
  params: unknown
}

export type CliReply =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: { code: string; message: string } }

export interface CliSession {
  id: string
  kind: SessionKind
  label: string
  status: NonNullable<Session['status']> | null
  waitingFor: Session['waitingFor'] | null
  lastStatus: Session['lastStatus']
  project: string
  cwd: string
  feature: string | null
  workflowStatus: WorkflowStatus
  parent: string | null // id of the session this one is linked to
  relation: 'group' | 'slice' | null // how it is linked; null when it has no parent
}
