import type { OcEvent } from './types'

// Every OpenCode 2.0.20 event shape grove reads lives here (design risk: Experimental API).
// Envelope: { id, type, created, data, location? }.

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null

function toIso(v: unknown): string {
  const d = typeof v === 'number' || typeof v === 'string' ? new Date(v) : new Date()
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

const ENDED = new Set(['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'])

export function normalise(raw: unknown, version: string): OcEvent | null {
  const e = obj(raw)
  if (!e || typeof e.type !== 'string') return null
  if (e.type === 'server.connected') return { type: 'connected', version }
  const sessionId = obj(e.data)?.sessionID
  if (typeof sessionId !== 'string') return null
  if (e.type === 'session.execution.started') return { type: 'exec-started', sessionId }
  if (ENDED.has(e.type)) return { type: 'exec-ended', sessionId, at: toIso(e.created) }
  return null
}
