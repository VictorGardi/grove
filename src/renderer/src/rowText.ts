import type { Session } from '@shared/types'
import { statusView } from './sessionStatus'

// A name the app gave: "Terminal · 14:47", "Claude · 09:49", likewise OpenCode and Copilot.
const DEFAULT_LABEL = /^(Terminal|Claude|OpenCode|Copilot) · \d{1,2}:\d{2}$/

// A session still carrying its default name is titled by what it was doing, when that is known.
export function rowTitle(s: Session): string {
  return s.lastLine && DEFAULT_LABEL.test(s.label) ? s.lastLine : s.label
}

// The row's second line: a waiting permission/question says what it needs (the escalated reason
// first), else what it was doing, else its name and status.
export function rowLine(s: Session): string {
  const asks = !!s.attention || !(s.held || (s.parentId && s.waitingFor === 'done')) // a held or finished child is not asking: it reads by its named line
  if (asks && s.status === 'waiting' && s.waitingFor === 'permission') return s.attention?.reason || 'Needs permission'
  if (asks && s.status === 'waiting' && s.waitingFor === 'question') return s.attention?.reason || 'Has a question'
  if (s.classified?.verdict === 'needs-you' && s.status === 'waiting' && !s.lastLine) return 'May need an answer'
  const named = `${s.label} · ${statusView(s).label}`
  return s.lastLine && s.lastLine !== rowTitle(s) ? s.lastLine : named
}
