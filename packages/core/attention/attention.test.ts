import { beforeEach, describe, expect, it } from 'vitest'
import type { AttentionNotice, StatusChange } from '../../protocol/messages.ts'
import { Attention } from './attention.ts'

describe('Attention', () => {
  let notices: AttentionNotice[]
  let seen: string[]
  let attention: Attention

  const change = (tabId: string, state: StatusChange['state'], reason?: StatusChange['reason']): StatusChange => ({
    tabId,
    agent: 'claude',
    state,
    since: 0,
    source: 'claude',
    ...(reason !== undefined ? { reason } : {}),
  })

  beforeEach(() => {
    notices = []
    seen = []
    attention = new Attention({
      notify: (notice) => notices.push(notice),
      markSeen: (tabId) => seen.push(tabId),
    })
  })

  it('notifies a tab entering needs-you with its reason, off screen', () => {
    attention.onStatus(change('t1', 'needs-you', 'permission'))
    attention.onStatus(change('t2', 'needs-you', 'question'))
    attention.onStatus(change('t3', 'needs-you', 'error'))
    expect(notices).toEqual([
      { tabId: 't1', state: 'needs-you', reason: 'permission' },
      { tabId: 't2', state: 'needs-you', reason: 'question' },
      { tabId: 't3', state: 'needs-you', reason: 'error' },
    ])
  })

  it('notifies a tab entering finished, off screen', () => {
    attention.onStatus(change('t1', 'finished'))
    expect(notices).toEqual([{ tabId: 't1', state: 'finished' }])
  })

  it('notifies once per entry, not again for the same state', () => {
    attention.onStatus(change('t1', 'needs-you', 'permission'))
    attention.onStatus(change('t1', 'needs-you', 'permission'))
    attention.onStatus(change('t1', 'finished'))
    attention.onStatus(change('t1', 'finished'))
    expect(notices).toHaveLength(2)
  })

  it('notifies again when the reason of needs-you changes', () => {
    attention.onStatus(change('t1', 'needs-you', 'permission'))
    attention.onStatus(change('t1', 'needs-you', 'question'))
    expect(notices.map((notice) => notice.reason)).toEqual(['permission', 'question'])
  })

  it('notifies again after the tab leaves and re-enters the attention state', () => {
    attention.onStatus(change('t1', 'needs-you', 'permission'))
    attention.onStatus(change('t1', 'working'))
    attention.onStatus(change('t1', 'needs-you', 'permission'))
    expect(notices).toHaveLength(2)
  })

  it('notifies a second finish after the tab was seen, once it is idle again', () => {
    attention.onStatus(change('t1', 'finished'))
    attention.onStatus(change('t1', 'idle'))
    attention.onStatus(change('t1', 'finished'))
    expect(notices).toEqual([
      { tabId: 't1', state: 'finished' },
      { tabId: 't1', state: 'finished' },
    ])
  })

  it('does not notify for unknown, working, or idle', () => {
    attention.onStatus(change('t1', 'working'))
    attention.onStatus(change('t1', 'unknown'))
    attention.onStatus(change('t1', 'idle'))
    expect(notices).toEqual([])
    expect(seen).toEqual([])
  })

  it('does not notify for the tab on screen while the window is focused', () => {
    attention.focus('t1', true)
    attention.onStatus(change('t1', 'needs-you', 'permission'))
    expect(notices).toEqual([])
  })

  it('still notifies for a tab on screen when the window is not focused', () => {
    attention.focus('t1', false)
    attention.onStatus(change('t1', 'needs-you', 'permission'))
    expect(notices).toHaveLength(1)
  })

  it('marks a finished tab on screen seen at once, and does not notify for it', () => {
    attention.focus('t1', true)
    seen.length = 0
    attention.onStatus(change('t1', 'finished'))
    expect(seen).toEqual(['t1'])
    expect(notices).toEqual([])
  })

  it('does not mark a finished tab seen when it is not on screen', () => {
    attention.focus('t2', true)
    seen.length = 0
    attention.onStatus(change('t1', 'finished'))
    expect(seen).toEqual([])
    expect(notices).toHaveLength(1)
  })

  it('marks the tab on screen seen when focus moves to it, and only while the window is focused', () => {
    attention.focus('t1', true)
    expect(seen).toEqual(['t1'])
    attention.focus('t2', false)
    attention.focus(null, true)
    expect(seen).toEqual(['t1'])
  })

  it('does not notify again when a tab seen on screen keeps the same entry after focus moves away', () => {
    attention.focus('t1', true)
    attention.onStatus(change('t1', 'needs-you', 'permission'))
    attention.focus('t2', true)
    attention.onStatus(change('t1', 'needs-you', 'permission'))
    expect(notices).toEqual([])
  })

  it('notifies a finished tab that was on screen when the window loses focus', () => {
    attention.focus('t1', true)
    attention.focus('t1', false)
    attention.onStatus(change('t1', 'finished'))
    expect(notices).toEqual([{ tabId: 't1', state: 'finished' }])
  })
})
