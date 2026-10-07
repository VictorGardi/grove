import type { Session, SessionKind } from './types'

// The grove CLI's wire protocol (ADR 0027): one JSON line per connection, over a Unix socket.
export const PROTOCOL = 1

export interface CliMethods {
  'sessions.list': { params: { all?: boolean }; data: CliSession[] }
  'sessions.create': {
    params: { kind: SessionKind; cwd: string; prompt?: string; label?: string; feature?: string; wait?: boolean; timeoutS?: number }
    data: CliSession & { turn?: TurnResult }
  }
  'sessions.send': { params: { ref: string; text: string; submit: boolean; wait?: boolean; timeoutS?: number }; data: { id: string; turn?: TurnResult } }
  'sessions.wait': { params: { ref: string; timeoutS?: number }; data: { id: string } & TurnResult }
  'sessions.read': { params: { ref: string; lines: number }; data: { text: string } }
}

// How a wait ended: `waiting` is for permission or a question. The CLI exits 0, 4, 5.
export interface TurnResult {
  status: 'idle' | 'waiting' | 'gone'
  waitingFor: Session['waitingFor'] | null
}

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
}
