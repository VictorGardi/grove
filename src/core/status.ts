import type { Session } from '@shared/types'
import type { OcEvent } from './opencode/types'

// Live OpenCode state per root session; a subagent's events fold into its root.
export interface Tracker {
  running: boolean
  pending: Map<string, 'permission' | 'question'>
  idleAt: string | null
  children: Set<string>
}

const blank = (): Tracker => ({ running: false, pending: new Map(), idleAt: null, children: new Set() })

// Returns the same map for events that change no tracker; never mutates its input.
// A child's pending items count for its root; its own turns don't (the parent's turn spans them).
export function apply(t: Map<string, Tracker>, roots: Map<string, string>, e: OcEvent): Map<string, Tracker> {
  if (e.type === 'connected' || e.type === 'disconnected') return t
  if ((e.type === 'exec-started' || e.type === 'exec-ended') && roots.has(e.sessionId)) return t
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

// Precedence: permission > question > working > idle.
export function statusOf(t: Tracker | undefined, _seenAt: string | null): Pick<Session, 'status' | 'waitingFor'> {
  const kinds = new Set(t?.pending.values())
  if (kinds.has('permission')) return { status: 'waiting', waitingFor: 'permission' }
  if (kinds.has('question')) return { status: 'waiting', waitingFor: 'question' }
  return { status: t?.running ? 'working' : 'idle' }
}

// OpenCode sessions get a status while the service is connected; otherwise none (tmux liveness shows).
// Same array when unchanged.
export function withStatus(sessions: Session[], t: Map<string, Tracker>, connected: boolean): Session[] {
  let changed = false
  const out = sessions.map((s) => {
    const live = connected && s.opencodeSessionId ? statusOf(t.get(s.opencodeSessionId), null) : {}
    const same = (k: 'status' | 'waitingFor') => live[k] === s[k] && (live[k] !== undefined || !(k in s))
    if (same('status') && same('waitingFor')) return s
    changed = true
    const { status: _status, waitingFor: _waitingFor, ...rest } = s
    return { ...rest, ...live }
  })
  return changed ? out : sessions
}
