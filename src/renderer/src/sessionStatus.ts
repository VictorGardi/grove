import type { OpenCodeSlice, Session } from '@shared/types'
import type { StatusTone } from './components/ui/StatusDot'

export type ShownStatus = 'running' | 'gone' | 'working' | 'waiting' | 'idle'

// gone (tmux) wins; else the live agent status; else tmux running (terminals, or no service).
export function shownStatus(s: Session): ShownStatus {
  if (s.lastStatus === 'gone') return 'gone'
  return s.status ?? 'running'
}

export function statusView(s: Session): { label: string; tone: StatusTone } {
  const shown = shownStatus(s)
  return { label: shown === 'waiting' && s.waitingFor ? `waiting · ${s.waitingFor}` : shown, tone: shown }
}

// The colour a live-status dot draws. An agent that finished and nobody has looked reads as
// finished rather than waiting, so it stops pulsing. The rail tile and the session card both
// go through this, so the two views can't drift apart.
export function statusTone(s: Session): StatusTone {
  const shown = shownStatus(s)
  return shown === 'waiting' && s.waitingFor === 'done' ? 'finished' : shown
}

// When the renderer first saw each session waiting (ms). Same object when unchanged.
export function trackWaiting(prev: Record<string, number>, sessions: Session[], now: number): Record<string, number> {
  const next: Record<string, number> = {}
  for (const s of sessions) if (shownStatus(s) === 'waiting') next[s.id] = prev[s.id] ?? now
  const keys = Object.keys(next)
  const same = keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k])
  return same ? prev : next
}

// The waiting session seen waiting first; unknown times sort last, ties keep list order.
export function longestWaiting(sessions: Session[], since: Record<string, number>): Session | null {
  let best: Session | null = null
  for (const s of sessions) {
    if (shownStatus(s) !== 'waiting') continue
    if (!best || (since[s.id] ?? Infinity) < (since[best.id] ?? Infinity)) best = s
  }
  return best
}

// What the sandbox mark says about a session, in one place so the card and the header cannot
// drift. `lost` is the case a bare `sandboxed` flag cannot express (ADR 0033): the session was
// confined and its resume came back without the sandbox, so the mark must not go dark — `false`
// alone is also what a session that was never sandboxed looks like. A live sandbox wins over a
// note: if one is running, nothing was lost, whatever a stale note claims.
export function sandboxView(s: Session): { state: 'sandboxed' | 'lost' | 'none'; label?: string } {
  if (s.sandboxed) return { state: 'sandboxed', label: 'Sandboxed' }
  if (s.sandboxNote) return { state: 'lost', label: 'Not sandboxed' }
  return { state: 'none' }
}

// Show an error only when a live OpenCode session loses its service connection.
export function serviceBanners(oc: OpenCodeSlice, sessions: Session[]): { tone: 'error'; text: string }[] {
  if (oc.state === 'unreachable' && sessions.some((s) => s.kind === 'opencode' && s.lastStatus === 'running')) {
    return [{ tone: 'error', text: 'OpenCode service unreachable — showing tmux status only' }]
  }
  return []
}
