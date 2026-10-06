import type { Session } from '@shared/types'
import type { StatusTone } from './components/ui/StatusDot'

export type ShownStatus = 'running' | 'gone' | 'working' | 'waiting' | 'idle'

// gone (tmux) wins; else the live OpenCode status; else tmux running (terminals, or no service).
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

// The waiting session seen waiting first; unknown times sort last, ties keep list order.
export function longestWaiting(sessions: Session[], since: Record<string, number>): Session | null {
  let best: Session | null = null
  for (const s of sessions) {
    if (shownStatus(s) !== 'waiting') continue
    if (!best || (since[s.id] ?? Infinity) < (since[best.id] ?? Infinity)) best = s
  }
  return best
}
