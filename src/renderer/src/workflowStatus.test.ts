import { describe, expect, it } from 'vitest'
import { WORKFLOW_STATUSES, workflowStatusOf } from './workflowStatus'

describe('WORKFLOW_STATUSES', () => {
  it('lists the seven Xirp statuses in order with their labels', () => {
    expect(WORKFLOW_STATUSES.map((s) => s.value)).toEqual([
      'backlog', 'in-progress', 'blocked', 'in-review', 'cancelled', 'done', 'pinned',
    ])
    expect(WORKFLOW_STATUSES.map((s) => s.label)).toEqual([
      'Backlog', 'In Progress', 'Blocked', 'In Review', 'Cancelled', 'Done', 'Pinned',
    ])
  })

  it('gives every status a glyph and a tone', () => {
    expect(WORKFLOW_STATUSES.map((s) => s.glyph)).toEqual([
      'dashed', 'partial', 'partial', 'clock', 'cross', 'check', 'pin',
    ])
    expect(WORKFLOW_STATUSES.map((s) => s.tone)).toEqual([
      'muted', 'waiting', 'accent', 'working', 'muted', 'finished', 'accent',
    ])
  })

  it('looks up a status, falling back to in-progress', () => {
    expect(workflowStatusOf('pinned').label).toBe('Pinned')
    expect(workflowStatusOf('nonsense' as never).value).toBe('in-progress')
  })
})