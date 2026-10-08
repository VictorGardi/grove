import type { ContextReading, Session } from '@shared/types'
import type { AgentEvent, AgentKind, ContextUsage, SessionSnapshot } from './agents/types'

// Live agent state per root session; a subagent's events fold into its root.
export interface Tracker {
  running: boolean
  pending: Map<string, 'permission' | 'question'>
  idleAt: string | null
  children: Set<string>
  context: ContextUsage | null
}

const blank = (): Tracker => ({ running: false, pending: new Map(), idleAt: null, children: new Set(), context: null })

// Returns the same map for events that change no tracker; never mutates its input.
// A child's pending items count for its root; its own turns don't (the parent's turn spans them).
export function apply(t: Map<string, Tracker>, roots: Map<string, string>, e: AgentEvent): Map<string, Tracker> {
  if (e.type === 'connected' || e.type === 'disconnected' || e.type === 'wrote') return t
  if ((e.type === 'exec-started' || e.type === 'exec-ended') && roots.has(e.sessionId)) return t
  if (e.type === 'context') return new Map(t).set(e.sessionId, { ...(t.get(e.sessionId) ?? blank()), context: e.context })
  const root = e.type === 'child' ? roots.get(e.parentId) ?? e.parentId : roots.get(e.sessionId) ?? e.sessionId
  const cur = t.get(root) ?? blank()
  let next: Tracker
  if (e.type === 'exec-started') next = { ...cur, running: true }
  else if (e.type === 'exec-ended') next = { ...cur, running: false, idleAt: e.at }
  else if (e.type === 'child') next = { ...cur, children: new Set(cur.children).add(e.sessionId) }
  else {
    const pending = new Map(cur.pending)
    if (e.open) pending.set(e.id, e.kind)
    else pending.delete(e.id)
    next = { ...cur, pending }
  }
  return new Map(t).set(root, next)
}

// Trackers rebuilt from a re-sync: one per requested root, its children's pending items folded in.
export function fromSnapshot(snaps: Map<string, SessionSnapshot>, ids: string[]): { trackers: Map<string, Tracker>; roots: Map<string, string> } {
  const trackers = new Map<string, Tracker>()
  const roots = new Map<string, string>()
  for (const id of ids) {
    const s = snaps.get(id)
    if (!s) continue
    const pending = new Map<string, 'permission' | 'question'>()
    for (const sid of [id, ...s.children]) {
      for (const p of snaps.get(sid)?.pending ?? []) pending.set(p.id, p.kind)
      if (sid !== id) roots.set(sid, id)
    }
    trackers.set(id, { running: s.running, idleAt: s.idleAt, children: new Set(s.children), pending, context: s.context ?? null })
  }
  return { trackers, roots }
}

// Precedence: permission > question > working > finished and not yet seen > idle.
export function statusOf(t: Tracker | undefined, seenAt: string | null): Pick<Session, 'status' | 'waitingFor'> {
  const kinds = new Set(t?.pending.values())
  if (kinds.has('permission')) return { status: 'waiting', waitingFor: 'permission' }
  if (kinds.has('question')) return { status: 'waiting', waitingFor: 'question' }
  if (t?.running) return { status: 'working' }
  if (t?.idleAt && (seenAt === null || t.idleAt > seenAt)) return { status: 'waiting', waitingFor: 'done' }
  return { status: 'idle' }
}

// Sessions of `kind` get a status while their source is connected (with `needsEvent`, only once it has
// a tracker); otherwise none, and tmux liveness shows. Other kinds are left alone. Same array when unchanged.
export function withStatus(sessions: Session[], kind: AgentKind, t: Map<string, Tracker>, connected: boolean, needsEvent: boolean): Session[] {
  let changed = false
  const out = sessions.map((s) => {
    if (s.kind !== kind) return s
    const id = s.agentSessionId
    const live = connected && id && (!needsEvent || t.has(id)) ? statusOf(t.get(id), s.seenAt) : {}
    const same = (k: 'status' | 'waitingFor') => live[k] === s[k] && (live[k] !== undefined || !(k in s))
    if (same('status') && same('waitingFor')) return s
    changed = true
    const { status: _status, waitingFor: _waitingFor, ...rest } = s
    return { ...rest, ...live }
  })
  return changed ? out : sessions
}

// Live context fields (never saved) from the trackers, and `lastContext` kept at the latest reading with a known
// percentage. Same gating as withStatus; a reading is also kept after the source drops (an ended session shows it dimmed).
export function withContext(sessions: Session[], kind: AgentKind, t: Map<string, Tracker>, connected: boolean): Session[] {
  let changed = false
  const out = sessions.map((s) => {
    if (s.kind !== kind) return s
    const c = connected && s.agentSessionId ? t.get(s.agentSessionId)?.context : undefined
    const last: ContextReading | null = c && c.pct !== null ? { pct: c.pct, tokens: c.tokens, window: c.window } : s.lastContext
    const sameLast = last === s.lastContext || (!!last && !!s.lastContext && last.pct === s.lastContext.pct && last.tokens === s.lastContext.tokens && last.window === s.lastContext.window)
    const sameLive = c
      ? s.contextPct === c.pct && s.contextTokens === c.tokens && s.contextWindow === c.window && s.model === c.model
      : !('contextPct' in s) && !('contextTokens' in s) && !('contextWindow' in s) && !('model' in s)
    if (sameLast && sameLive) return s
    changed = true
    const { contextPct: _p, contextTokens: _t, contextWindow: _w, model: _m, ...rest } = s
    return { ...rest, lastContext: sameLast ? s.lastContext : last, ...(c && { contextPct: c.pct, contextTokens: c.tokens, contextWindow: c.window, model: c.model }) }
  })
  return changed ? out : sessions
}
