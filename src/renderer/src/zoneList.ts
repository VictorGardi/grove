import type { Session, Zone } from '@shared/types'
import { statusView } from './sessionStatus'

export const RECENT_COUNT = 5

export interface ZoneSections {
  needsYou: Session[] // children included: a child that needs you is its own row
  review: Session[] // top-level only
  runningRows: Session[] // working sessions, top level and children; shown collapsed to a count
  runningCount: number
  recent: Session[] // where the human was last, none of which is in a zone above
}

// The sidebar's zones view, from each session's derived zone (shared/zones.ts). A finished child
// has no zone and so no row; a child is a row of its own only while it needs you. A session
// appears once: `recent` leaves out everything already in a zone.
export function zoneSections(sessions: Session[]): ZoneSections {
  const inZone = (z: NonNullable<Session['zone']>) => sessions.filter((s) => s.zone === z)
  const needsYou = inZone('needs-you')
  const review = inZone('review').filter((s) => !s.parentId)
  const runningRows = inZone('running')
  const recent = sessions
    .filter((s) => s.lastFocusedAt && !s.zone && !s.parentId)
    .sort((a, b) => Date.parse(b.lastFocusedAt!) - Date.parse(a.lastFocusedAt!))
    .slice(0, RECENT_COUNT)
  return { needsYou, review, runningRows, runningCount: runningRows.length, recent }
}

// A name the app gave: "Terminal · 14:47", "Claude · 09:49", likewise OpenCode and Copilot.
const DEFAULT_LABEL = /^(Terminal|Claude|OpenCode|Copilot) · \d{1,2}:\d{2}$/

// A session still carrying its default name is titled by what it was doing, when that is known.
export function rowTitle(s: Session): string {
  return s.lastLine && DEFAULT_LABEL.test(s.label) ? s.lastLine : s.label
}

// The row's second line: a waiting permission/question says what it needs (the escalated reason
// first), else what it was doing, else its name and status.
export function rowLine(s: Session): string {
  if (s.status === 'waiting' && s.waitingFor === 'permission') return s.attention?.reason || 'Needs permission'
  if (s.status === 'waiting' && s.waitingFor === 'question') return s.attention?.reason || 'Has a question'
  const named = `${s.label} · ${statusView(s).label}`
  return s.lastLine && s.lastLine !== rowTitle(s) ? s.lastLine : named
}

// Where "Move to zone" may put a row. A child is never a row in Ready to review (a finished
// child keeps its look under its parent), so that zone is not offered for one.
export function zonesFor(s: Session): Zone[] {
  return s.parentId ? ['needs-you', 'running'] : ['needs-you', 'review', 'running']
}
