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

// When the renderer first saw each session waiting (ms). Same object when unchanged.
export function trackWaiting(prev: Record<string, number>, sessions: Session[], now: number): Record<string, number> {
  const next: Record<string, number> = {}
  for (const s of sessions) if (shownStatus(s) === 'waiting') next[s.id] = prev[s.id] ?? now
  const keys = Object.keys(next)
  const same = keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k])
  return same ? prev : next
}

export interface StatusSince { status: ShownStatus; since: number }

// When the renderer first saw each session in its current shown status (ms). Same object when unchanged.
export function trackStatus(prev: Record<string, StatusSince>, sessions: Session[], now: number): Record<string, StatusSince> {
  const next: Record<string, StatusSince> = {}
  for (const s of sessions) {
    const status = shownStatus(s)
    next[s.id] = prev[s.id]?.status === status ? prev[s.id] : { status, since: now }
  }
  const keys = Object.keys(next)
  const same = keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k])
  return same ? prev : next
}

// A short age: "now", "5m", "3h", "2d".
export function duration(ms: number): string {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
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
