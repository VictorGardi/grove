import type { OpenCodeSlice, Session } from '@shared/types'
import type { StatusTone } from './components/ui/StatusDot'

export type ShownStatus = 'running' | 'gone' | 'working' | 'waiting' | 'idle' | 'starting' | 'failed'

// gone (tmux) wins; else the live agent status; else tmux running (terminals, or no service).
export function shownStatus(s: Session): ShownStatus {
  if (s.startup?.phase === 'failed') return 'failed' // the start failed: an error card, even over a resumable gone session
  if (s.lastStatus === 'gone') return 'gone'
  if (s.startup?.phase === 'starting') return 'starting' // no status yet: the card shows a spinner
  return s.status ?? 'running'
}

export function statusView(s: Session): { label: string; tone: StatusTone } {
  const shown = shownStatus(s)
  if (s.startup?.phase === 'failed') return { label: `failed · ${s.startup.reason}`, tone: 'failed' }
  return { label: shown === 'waiting' && s.waitingFor ? `waiting · ${s.waitingFor}` : shown, tone: shown }
}

// The colour a live-status dot draws. An agent that finished and nobody has looked reads as
// finished rather than waiting, so it stops pulsing. Every status dot goes through this, so no
// two views can drift apart.
export function statusTone(s: Session): StatusTone {
  const shown = shownStatus(s)
  return shown === 'waiting' && s.waitingFor === 'done' ? 'finished' : shown
}

// What a collapsed group shows for its children: the one that most needs the human, so a waiting
// child is never hidden behind its parent. null for no children.
const URGENCY: ShownStatus[] = ['failed', 'waiting', 'working', 'idle', 'starting', 'running', 'gone']
export function mostUrgent(sessions: Session[]): Session | null {
  let best: Session | null = null
  for (const s of sessions) if (!best || URGENCY.indexOf(shownStatus(s)) < URGENCY.indexOf(shownStatus(best))) best = s
  return best
}

// When the renderer first saw each session waiting (ms). Same object when unchanged.
export function trackWaiting(prev: Record<string, number>, sessions: Session[], now: number): Record<string, number> {
  const next: Record<string, number> = {}
  for (const s of sessions) if (shownStatus(s) === 'waiting') next[s.id] = prev[s.id] ?? now
  const keys = Object.keys(next)
  const same = keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k])
  return same ? prev : next
}

// Time in status as a card shows it: "now", then minutes, hours, days.
export function statusAge(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
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

// Show an error only when a live OpenCode session loses its service connection.
export function serviceBanners(oc: OpenCodeSlice, sessions: Session[]): { tone: 'error'; text: string }[] {
  if (oc.state === 'unreachable' && sessions.some((s) => s.kind === 'opencode' && s.lastStatus === 'running')) {
    return [{ tone: 'error', text: 'OpenCode service unreachable — showing tmux status only' }]
  }
  return []
}
