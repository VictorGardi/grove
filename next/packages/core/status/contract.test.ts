import { describe, expect, it } from 'vitest'
import { applyEvent, GRACE_MS, SILENCE_MS, unknownStatus, type Status } from './contract.ts'

const idle: Status = { state: 'idle', since: 100 }

describe('applyEvent', () => {
  it('moves to working and stamps the time', () => {
    expect(applyEvent(idle, { kind: 'working' }, 200)).toEqual({ state: 'working', since: 200 })
  })

  it('keeps since when working repeats', () => {
    const working: Status = { state: 'working', since: 200 }
    expect(applyEvent(working, { kind: 'working' }, 500)).toBe(working)
  })

  it('moves to needs-you with its reason', () => {
    expect(applyEvent(idle, { kind: 'needs-you', reason: 'permission' }, 300)).toEqual({
      state: 'needs-you',
      reason: 'permission',
      since: 300,
    })
  })

  it('treats a new needs-you reason as a change and the same reason as no change', () => {
    const asked: Status = { state: 'needs-you', reason: 'question', since: 300 }
    expect(applyEvent(asked, { kind: 'needs-you', reason: 'question' }, 400)).toBe(asked)
    expect(applyEvent(asked, { kind: 'needs-you', reason: 'error' }, 400)).toEqual({
      state: 'needs-you',
      reason: 'error',
      since: 400,
    })
  })

  it('moves to finished and to idle', () => {
    expect(applyEvent(idle, { kind: 'finished' }, 250)).toEqual({ state: 'finished', since: 250 })
    expect(applyEvent({ state: 'finished', since: 250 }, { kind: 'idle' }, 260)).toEqual({ state: 'idle', since: 260 })
  })

  it('moves a working or needs-you turn to finished on idle-prompt', () => {
    expect(applyEvent({ state: 'working', since: 200 }, { kind: 'idle-prompt' }, 260)).toEqual({ state: 'finished', since: 260 })
    expect(applyEvent({ state: 'needs-you', reason: 'question', since: 300 }, { kind: 'idle-prompt' }, 310)).toEqual({
      state: 'finished',
      since: 310,
    })
    expect(applyEvent({ state: 'needs-you', reason: 'permission', since: 300 }, { kind: 'idle-prompt' }, 310)).toEqual({
      state: 'finished',
      since: 310,
    })
  })

  it('keeps since when idle-prompt repeats finished or idle', () => {
    const finished: Status = { state: 'finished', since: 150 }
    expect(applyEvent(finished, { kind: 'idle-prompt' }, 999)).toBe(finished)
    expect(applyEvent(idle, { kind: 'idle-prompt' }, 999)).toBe(idle)
  })

  it('moves unknown to idle on idle-prompt', () => {
    expect(applyEvent(unknownStatus(900), { kind: 'idle-prompt' }, 1000)).toEqual({ state: 'idle', since: 1000 })
  })

  it('leaves unknown on every real event', () => {
    const stuck = unknownStatus(900)
    expect(applyEvent(stuck, { kind: 'working' }, 1000)).toEqual({ state: 'working', since: 1000 })
    expect(applyEvent(stuck, { kind: 'needs-you', reason: 'permission' }, 1000).state).toBe('needs-you')
    expect(applyEvent(stuck, { kind: 'finished' }, 1000)).toEqual({ state: 'finished', since: 1000 })
    expect(applyEvent(stuck, { kind: 'idle' }, 1000)).toEqual({ state: 'idle', since: 1000 })
  })

  it('never changes state on heartbeat or session', () => {
    const working: Status = { state: 'working', since: 200 }
    expect(applyEvent(working, { kind: 'heartbeat' }, 999)).toBe(working)
    expect(applyEvent(idle, { kind: 'heartbeat' }, 999)).toBe(idle)
    expect(applyEvent(unknownStatus(900), { kind: 'heartbeat' }, 999)).toEqual(unknownStatus(900))
    expect(applyEvent(idle, { kind: 'session', resumeId: 'abc' }, 999)).toBe(idle)
  })

  it('exposes the default thresholds', () => {
    expect(GRACE_MS).toBe(3000)
    expect(SILENCE_MS).toBe(30000)
  })
})
