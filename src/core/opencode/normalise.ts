import type { OcEvent } from './types'

// Every OpenCode 2.0.20 event shape grove reads lives here (design risk: Experimental API).
// Envelope: { id, type, created, data, location? }.

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null

function toIso(v: unknown): string {
  const d = typeof v === 'number' || typeof v === 'string' ? new Date(v) : new Date()
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

const FORM = new Set(['form.created', 'form.replied', 'form.cancelled']) // every form counts as a question

function pending(sessionId: unknown, id: unknown, kind: 'permission' | 'question', open: boolean): OcEvent | null {
  return typeof sessionId === 'string' && typeof id === 'string' ? { type: 'pending', sessionId, id, kind, open } : null
}

const ENDED = new Set(['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'])

export function normalise(raw: unknown, version: string): OcEvent | null {
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
