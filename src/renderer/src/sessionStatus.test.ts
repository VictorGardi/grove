import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { duration, longestWaiting, serviceBanners, shownStatus, statusView, trackStatus, trackWaiting } from './sessionStatus'

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'a', projectId: 'p', kind: 'opencode', label: 'a', labelPinned: false, tmuxName: 'grove-a',
    agentSessionId: 'ses_a', feature: null, linkPinned: false, action: null,
    startedAt: '2026-10-05T10:00:00.000Z', endedAt: null, lastStatus: 'running', seenAt: null, ...over,
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

describe('serviceBanners', () => {
  const unreachable = { state: 'unreachable' as const, version: null }
  const UNREACHABLE = { tone: 'error', text: 'OpenCode service unreachable — showing tmux status only' }

  it('shows the unreachable banner only while an OpenCode session is live', () => {
    expect(serviceBanners(unreachable, [session()])).toEqual([UNREACHABLE])
    expect(serviceBanners(unreachable, [session({ kind: 'terminal', agentSessionId: null })])).toEqual([])
    expect(serviceBanners(unreachable, [session({ lastStatus: 'gone' })])).toEqual([])
    expect(serviceBanners({ state: 'connecting', version: null }, [session()])).toEqual([])
  })

  it('flags an untested OpenCode version', () => {
    expect(serviceBanners({ state: 'connected', version: '2.0.20' }, [session()])).toEqual([])
    expect(serviceBanners({ state: 'connected', version: '2.1.0' }, [])).toEqual([
      { tone: 'info', text: 'Untested OpenCode version 2.1.0 (grove is tested with 2.0.20)' },
    ])
  })
})

describe('trackStatus', () => {
  it('keeps since while the status holds, resets it on change, drops removed sessions', () => {
    const first = trackStatus({}, [session({ id: 'a', status: 'working' }), session({ id: 'b' })], 100)
    expect(first).toEqual({ a: { status: 'working', since: 100 }, b: { status: 'running', since: 100 } })
    expect(trackStatus(first, [session({ id: 'a', status: 'working' }), session({ id: 'b' })], 200)).toBe(first)
    expect(trackStatus(first, [session({ id: 'a', status: 'idle' })], 300)).toEqual({ a: { status: 'idle', since: 300 } })
  })
})

describe('duration', () => {
  it('rounds down to now, minutes, hours or days', () => {
    expect(duration(30_000)).toBe('now')
    expect(duration(5 * 60_000 + 1)).toBe('5m')
    expect(duration(3 * 3_600_000 + 1)).toBe('3h')
    expect(duration(2 * 86_400_000 + 1)).toBe('2d')
  })
})
