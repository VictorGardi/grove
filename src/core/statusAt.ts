import type { Session } from '@shared/types'

// Which status a session is in, as far as time in status goes: a change of key restarts the clock.
export function statusKey(s: Session): string {
  if (s.lastStatus === 'gone') return 'gone'
  if (s.startup) return s.startup.phase
  return s.status ? `${s.status}:${s.waitingFor ?? ''}` : 'running'
}

// Stamps `statusAt`, when each session entered its current status, onto a sessions slice about to
// be published: kept while the key holds, set when it changes. An ended session counts from its end,
// a starting one from its start, and an idle or finished agent session from the end of its last turn
// (`idleAt`, which the agent source re-syncs), so a relaunch keeps those times; anything else counts
// from now. Same array when nothing changed.
export function withStatusAt(prev: Session[], next: Session[], now: string, idleAt: (s: Session) => string | null | undefined): Session[] {
  const before = new Map(prev.map((s) => [s.id, s] as const))
  let changed = false
  const out = next.map((s) => {
    const p = before.get(s.id)
    const key = statusKey(s)
    const kept = p && p.statusAt && statusKey(p) === key ? p.statusAt : undefined
    const at = kept ?? (
      key === 'gone' ? s.endedAt ?? now
        : s.startup?.phase === 'starting' ? s.startup.since
          : s.status === 'idle' || s.waitingFor === 'done' ? idleAt(s) ?? now
            : now)
    if (s.statusAt === at) return s
    changed = true
    return { ...s, statusAt: at }
  })
  return changed ? out : next
}
