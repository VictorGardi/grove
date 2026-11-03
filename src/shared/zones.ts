import type { Session, Zone } from './types'

export const ZONES: Zone[] = ['needs-you', 'review', 'running']

export const isZone = (v: unknown): v is Zone => typeof v === 'string' && (ZONES as string[]).includes(v)

// Where a session's row belongs in the sidebar, worked out in one place. The human's override
// wins; it only moves the row (D5): counts, popups and cmd+. follow the real state elsewhere.
// null: no zone (a finished child keeps its finished look under its parent; idle and plain
// terminals are not in any zone).
export function zoneOf(s: Session): Zone | null {
  if (s.zoneOverride && isZone(s.zoneOverride)) return s.zoneOverride
  if (s.lastStatus === 'gone' || s.startup) return null
  if (s.status === 'waiting') {
    if (s.attention) return 'needs-you' // a parent escalated this wait to the human
    if (s.held) return 'running' // a child's prompt in its grace window: its parent may still answer it
    if (s.waitingFor === 'done') return s.parentId ? null : s.classified?.verdict === 'needs-you' ? 'needs-you' : 'review' // the small model judged a finished session to be asking something
    return 'needs-you' // permission, question, or anything unsure
  }
  if (s.workflowStatus === 'in-review') return 'review'
  if (s.status === 'working') return 'running'
  return null
}
