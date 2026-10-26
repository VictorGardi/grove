import type { Session } from '@shared/types'
import { shownStatus, type ShownStatus } from './sessionStatus'

export interface Family {
  parent: Session | null
  children: Session[]
  active: Session | null
}

// A child is ended once its pane is gone or its start failed: it can't be the one to jump to.
const ended = (s: Session) => {
  const shown = shownStatus(s)
  return shown === 'gone' || shown === 'failed'
}

// Running children, most worth a look first. waiting covers every waitingFor, 'done' included;
// running is a live pane with no agent status (a terminal); starting has nothing to show yet.
const RANK: ShownStatus[] = ['waiting', 'working', 'idle', 'running', 'starting']

// A missing or malformed time is -Infinity, never NaN, so it sorts last.
const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? -Infinity : t
}

// Later first; a missing time sorts last.
const later = (a: string | null | undefined, b: string | null | undefined) => {
  const ta = time(a), tb = time(b)
  return ta === tb ? 0 : tb > ta ? 1 : -1
}

function byRunning(a: Session, b: Session): number {
  const ra = RANK.indexOf(shownStatus(a)), rb = RANK.indexOf(shownStatus(b))
  if (ra !== rb) return ra - rb
  return later(a.lastFocusedAt, b.lastFocusedAt) || later(a.startedAt, b.startedAt)
}

// A session's group as seen from it: its parent (if still there), its children (running first,
// by rank; then ended ones, newest first; never store order), and the child a jump goes to.
export function familyOf(sessions: Session[], id: string): Family {
  const self = sessions.find((s) => s.id === id)
  const parent = self?.parentId ? sessions.find((s) => s.id === self.parentId) ?? null : null
  const mine = sessions.filter((s) => s.parentId === id)
  const running = mine.filter((s) => !ended(s)).sort(byRunning)
  const done = mine.filter(ended).sort((a, b) => later(a.startedAt, b.startedAt))
  return { parent, children: [...running, ...done], active: running[0] ?? null }
}
