import type { Session, SessionKind } from './types'

// The grove CLI's wire protocol (ADR 0027): one JSON line per connection, over a Unix socket.
export const PROTOCOL = 1

export interface CliMethods {
  'sessions.list': { params: { all?: boolean }; data: CliSession[] }
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
