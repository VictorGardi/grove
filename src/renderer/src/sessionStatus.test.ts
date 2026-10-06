import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { longestWaiting, shownStatus, statusView, trackWaiting } from './sessionStatus'

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'a', projectId: 'p', kind: 'opencode', label: 'a', labelPinned: false, tmuxName: 'grove-a',
    opencodeSessionId: 'ses_a', feature: null, linkPinned: false, action: null,
    startedAt: '2026-10-05T10:00:00.000Z', endedAt: null, lastStatus: 'running', ...over,
  }
}

describe('shownStatus', () => {
  it('prefers gone, then the live status, then tmux running', () => {
    expect(shownStatus(session({ lastStatus: 'gone', status: 'working' }))).toBe('gone')
    expect(shownStatus(session({ status: 'working' }))).toBe('working')
    expect(shownStatus(session({ status: 'idle' }))).toBe('idle')
    expect(shownStatus(session())).toBe('running')
  })

  it('uses the shown status as label and tone', () => {
    expect(statusView(session({ status: 'working' }))).toEqual({ label: 'working', tone: 'working' })
  })
})

describe('waiting', () => {
  const waiting = (id: string) => session({ id, status: 'waiting', waitingFor: 'question' })

  it('labels what a session waits for', () => {
    expect(statusView(session({ status: 'waiting', waitingFor: 'permission' }))).toEqual({ label: 'waiting · permission', tone: 'waiting' })
    expect(statusView(waiting('a')).label).toBe('waiting · question')
  })

  it('remembers when each session started waiting', () => {
    const first = trackWaiting({}, [waiting('a'), session({ id: 'b', status: 'idle' })], 100)
    expect(first).toEqual({ a: 100 })
    expect(trackWaiting(first, [waiting('a')], 200)).toBe(first)
    expect(trackWaiting(first, [waiting('a'), waiting('b')], 200)).toEqual({ a: 100, b: 200 })
    expect(trackWaiting(first, [session({ id: 'a', status: 'idle' })], 200)).toEqual({})
    expect(trackWaiting(first, [session({ id: 'a', status: 'waiting', lastStatus: 'gone' })], 200)).toEqual({})
  })

  it('finds the longest-waiting session', () => {
    const list = [session({ id: 'x' }), waiting('a'), waiting('b'), waiting('c')]
    expect(longestWaiting(list, { a: 300, b: 100 })?.id).toBe('b')
    expect(longestWaiting(list, {})?.id).toBe('a')
    expect(longestWaiting([session()], {})).toBeNull()
  })
})
