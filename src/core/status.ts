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
export function apply(t: Map<string, Tracker>, roots: Map<string, string>, e: OcEvent): Map<string, Tracker> {
  if (e.type !== 'exec-started' && e.type !== 'exec-ended') return t
  const root = roots.get(e.sessionId) ?? e.sessionId
  const cur = t.get(root) ?? blank()
  const next = e.type === 'exec-started' ? { ...cur, running: true } : { ...cur, running: false, idleAt: e.at }
  return new Map(t).set(root, next)
}

export function statusOf(t: Tracker | undefined, _seenAt: string | null): Pick<Session, 'status'> {
  return { status: t?.running ? 'working' : 'idle' }
}

// OpenCode sessions get a status while the service is connected; otherwise none (tmux liveness shows).
// Same array when unchanged.
export function withStatus(sessions: Session[], t: Map<string, Tracker>, connected: boolean): Session[] {
  let changed = false
  const out = sessions.map((s) => {
    const status = connected && s.opencodeSessionId ? statusOf(t.get(s.opencodeSessionId), null).status : undefined
    if (status === s.status && (status !== undefined || !('status' in s))) return s
    changed = true
    const { status: _old, ...rest } = s
    return status === undefined ? rest : { ...rest, status }
  })
  return changed ? out : sessions
}
