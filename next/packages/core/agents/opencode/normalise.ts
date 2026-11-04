import type { StatusEvent } from '../../status/contract.ts'

// Every OpenCode 2.0.20 event shape the status reads lives here (design risk: Experimental API).
// Envelope: { id, type, created, data, location? }. Ported from src/core/opencode/normalise.ts; only the status
// reads are kept (no prompt, write, tool or context events).

export type PendingKind = 'permission' | 'question'

export type OpenCodeEvent =
  | { type: 'connected'; version: string }
  | { type: 'pending'; sessionId: string; id: string; kind: PendingKind; open: boolean }
  | { type: 'child'; sessionId: string; parentId: string }
  | { type: 'exec-started'; sessionId: string }
  | { type: 'exec-ended'; sessionId: string; at: string }

// What a re-sync reads for one session. Built by snapshotOf.
export interface OpenCodeSnapshot {
  known: boolean // false until OpenCode has the session (its first prompt): nothing to say yet
  running: boolean
  idleAt: string | null
  pending: { id: string; kind: PendingKind }[]
  children: string[]
}

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null

function toIso(v: unknown): string {
  const d = typeof v === 'number' || typeof v === 'string' ? new Date(v) : new Date()
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

const FORM = new Set(['form.created', 'form.replied', 'form.cancelled']) // every form counts as a question

function pending(sessionId: unknown, id: unknown, kind: PendingKind, open: boolean): OpenCodeEvent | null {
  return typeof sessionId === 'string' && typeof id === 'string' ? { type: 'pending', sessionId, id, kind, open } : null
}

const ENDED = new Set(['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'])

export function normalise(raw: unknown, version: string): OpenCodeEvent | null {
  const e = obj(raw)
  if (!e || typeof e.type !== 'string') return null
  if (e.type === 'server.connected') return { type: 'connected', version }
  const data = obj(e.data)
  if (e.type === 'permission.asked') return pending(data?.sessionID, data?.id, 'permission', true)
  if (e.type === 'permission.replied') return pending(data?.sessionID, data?.requestID, 'permission', false)
  if (FORM.has(e.type)) {
    const form = obj(data?.form) // form.created: the session id is only inside the form
    return pending(data?.sessionID ?? form?.sessionID, data?.id ?? form?.id, 'question', e.type === 'form.created')
  }
  if (e.type === 'session.created') {
    const info = obj(data?.info)
    const sessionId = data?.sessionID ?? data?.id ?? info?.id
    const parentId = data?.parentID ?? info?.parentID
    return typeof sessionId === 'string' && typeof parentId === 'string' ? { type: 'child', sessionId, parentId } : null
  }
  const sessionId = data?.sessionID
  if (typeof sessionId !== 'string') return null
  if (e.type === 'session.execution.started') return { type: 'exec-started', sessionId }
  if (ENDED.has(e.type)) return { type: 'exec-ended', sessionId, at: toIso(e.created) }
  return null
}

// HTTP bodies used on re-sync. Responses usually come as { data: … }.
export function unwrap(body: unknown): unknown {
  const b = obj(body)
  return b && 'data' in b ? b.data : body
}

const ids = (list: unknown): string[] =>
  Array.isArray(list) ? list.map((x) => obj(x)?.id).filter((id): id is string => typeof id === 'string') : []

// GET /api/session?parentID=… → the children's ids.
export function childIds(body: unknown): string[] {
  const list = Array.isArray(body) ? body : obj(body)?.items
  return ids(list)
}

// info: GET /api/session/:id (null on 404, not started yet); active: GET /api/session/active;
// permissions, forms: GET /api/session/:id/permission and /form. Bodies already unwrapped.
export function snapshotOf(info: unknown, active: unknown, permissions: unknown, forms: unknown): OpenCodeSnapshot {
  const i = obj(info)
  if (!i) return { known: false, running: false, idleAt: null, pending: [], children: [] }
  const idle = obj(i.time)?.idle
  const a = obj(active)
  return {
    known: true,
    running: typeof i.id === 'string' && !!a && i.id in a,
    idleAt: idle === undefined || idle === null ? null : toIso(idle),
    pending: [
      ...ids(permissions).map((id) => ({ id, kind: 'permission' as const })),
      ...ids(forms).map((id) => ({ id, kind: 'question' as const })),
    ],
    children: [],
  }
}

// The per-session fold the status is built from. `reported` is the last state this fold emitted, so a turn
// that ended while nothing listened can be told from an idle tab on re-sync.
export interface OpenCodeFold {
  running: boolean
  pending: Map<string, PendingKind>
  reported: 'working' | 'needs-you' | 'finished' | null
}

export const emptyFold = (): OpenCodeFold => ({ running: false, pending: new Map(), reported: null })

export interface FoldStep {
  fold: OpenCodeFold
  events: StatusEvent[]
}

function report(fold: OpenCodeFold, events: StatusEvent[]): FoldStep {
  let reported = fold.reported
  for (const e of events) {
    if (e.kind === 'working' || e.kind === 'needs-you') reported = e.kind
    else if (e.kind === 'finished' || e.kind === 'idle-prompt') reported = 'finished'
  }
  return { fold: { ...fold, reported }, events }
}

// One live event for the watched session. Other sessions and subagents (child) are the hub's to skip; here they
// change nothing. A closed permission or question goes back to working while the turn runs, and to needs-you
// while another one is still open.
export function statusFor(fold: OpenCodeFold, event: OpenCodeEvent): FoldStep {
  switch (event.type) {
    case 'exec-started':
      return report({ ...fold, running: true }, [{ kind: 'working' }])
    case 'exec-ended':
      // An ended execution cannot be answered, so its open items go with it.
      return report({ ...fold, running: false, pending: new Map() }, [{ kind: 'finished' }])
    case 'pending': {
      const pendingNow = new Map(fold.pending)
      if (event.open) {
        pendingNow.set(event.id, event.kind)
        return report({ ...fold, pending: pendingNow }, [{ kind: 'needs-you', reason: event.kind }])
      }
      pendingNow.delete(event.id)
      const next = { ...fold, pending: pendingNow }
      const still = [...pendingNow.values()].at(-1)
      if (still) return report(next, [{ kind: 'needs-you', reason: still }])
      if (fold.running) return report(next, [{ kind: 'working' }])
      return { fold: next, events: [] }
    }
    case 'connected':
    case 'child':
      return { fold, events: [] }
  }
}

// A re-sync snapshot of the watched session. Open items win; a running turn is working. Otherwise the session is
// idle: a turn that ended while nothing listened (even after a core restart, when the fold is fresh) must not stay
// working, so it is always idle-prompt. The service leaves finished and idle as they are. A session OpenCode does
// not know yet says nothing, as a tab that has not started is not idle.
export function statusOfSnapshot(fold: OpenCodeFold, snap: OpenCodeSnapshot): FoldStep {
  const next: OpenCodeFold = { running: snap.running, pending: new Map(snap.pending.map((p) => [p.id, p.kind])), reported: fold.reported }
  const first = snap.pending[0]
  if (first) return report(next, [{ kind: 'needs-you', reason: first.kind }])
  if (snap.running) return report(next, [{ kind: 'working' }])
  if (!snap.known) return { fold: next, events: [] }
  return report(next, [{ kind: 'idle-prompt' }])
}
