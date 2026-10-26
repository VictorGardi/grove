import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { newSession } from './sessions'
import { withStatusAt } from './statusAt'
import { NOW } from './testing/setup'

const T1 = '2026-10-05T11:00:00.000Z'
const T2 = '2026-10-05T12:00:00.000Z'
const IDLE = '2026-10-05T09:00:00.000Z'
const noIdle = () => null

function oc(over: Partial<Session> = {}): Session {
  return { ...newSession({ projectId: 'p', kind: 'opencode', now: NOW, id: 'a', agentSessionId: 'ses_a' }), ...over }
}

describe('withStatusAt', () => {
  it('stamps a new status with now and keeps it while the status holds', () => {
    const [first] = withStatusAt([], [oc({ status: 'working' })], T1, noIdle)
    expect(first.statusAt).toBe(T1)
    const same = [oc({ status: 'working', statusAt: T1 })]
    expect(withStatusAt([first], same, T2, noIdle)).toBe(same)
    // a pushed copy that lost the field gets the kept time back
    expect(withStatusAt([first], [oc({ status: 'working' })], T2, noIdle)[0].statusAt).toBe(T1)
  })

  it('restarts the clock when the status or its reason changes', () => {
    const prev = [oc({ status: 'waiting', waitingFor: 'question', statusAt: T1 })]
    expect(withStatusAt(prev, [oc({ status: 'waiting', waitingFor: 'permission', statusAt: T1 })], T2, noIdle)[0].statusAt).toBe(T2)
    expect(withStatusAt(prev, [oc({ status: 'working', statusAt: T1 })], T2, noIdle)[0].statusAt).toBe(T2)
  })

  it('counts idle and finished sessions from the end of their last turn, so a relaunch keeps the time', () => {
    const idleAt = () => IDLE
    expect(withStatusAt([], [oc({ status: 'idle' })], T2, idleAt)[0].statusAt).toBe(IDLE)
    expect(withStatusAt([], [oc({ status: 'waiting', waitingFor: 'done' })], T2, idleAt)[0].statusAt).toBe(IDLE)
    expect(withStatusAt([], [oc({ status: 'idle' })], T2, noIdle)[0].statusAt).toBe(T2)
  })

  it('counts an ended session from its end and a starting one from its start', () => {
    expect(withStatusAt([], [oc({ lastStatus: 'gone', endedAt: T1 })], T2, noIdle)[0].statusAt).toBe(T1)
    expect(withStatusAt([], [oc({ startup: { phase: 'starting', since: T1 } })], T2, noIdle)[0].statusAt).toBe(T1)
  })
})
