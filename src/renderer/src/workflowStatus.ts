import type { WorkflowStatus } from '@shared/types'

// The seven manual workflow labels, in pick order, with the glyph and tone each
// card marker draws. Tones reuse the live-status tokens so a marker sits in the
// same palette as the rest of the card.
export interface WorkflowStatusView {
  value: WorkflowStatus
  label: string
  glyph: 'dashed' | 'partial' | 'clock' | 'cross' | 'check' | 'pin'
  tone: 'muted' | 'waiting' | 'gone' | 'working' | 'finished'
}

export const WORKFLOW_STATUSES: WorkflowStatusView[] = [
  { value: 'backlog', label: 'Backlog', glyph: 'dashed', tone: 'muted' },
  { value: 'in-progress', label: 'In Progress', glyph: 'partial', tone: 'waiting' },
  { value: 'blocked', label: 'Blocked', glyph: 'partial', tone: 'gone' },
  { value: 'in-review', label: 'In Review', glyph: 'clock', tone: 'working' },
  { value: 'cancelled', label: 'Cancelled', glyph: 'cross', tone: 'muted' },
  { value: 'done', label: 'Done', glyph: 'check', tone: 'finished' },
  { value: 'pinned', label: 'Pinned', glyph: 'pin', tone: 'gone' },
]

// An unknown saved value reads as in-progress rather than throwing on a card.
export function workflowStatusOf(status: WorkflowStatus): WorkflowStatusView {
  return WORKFLOW_STATUSES.find((s) => s.value === status) ?? WORKFLOW_STATUSES[1]
}