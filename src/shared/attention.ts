import type { Session } from './types'

// Whether a session is asking the human right now: waiting, past any grace window, and not a
// finished child (it keeps its finished look on its own row, but its leader is the one to ask).
// One truth for the counts, cmd+., the palette, board cards, columns and feature cards.
export function asksHuman(s: Session): boolean {
  if (s.status !== 'waiting' || s.held) return false
  if (s.parentId && s.waitingFor === 'done') return false
  if (s.lastStatus === 'gone') return false
  return s.startup?.phase !== 'failed' && s.startup?.phase !== 'starting'
}
