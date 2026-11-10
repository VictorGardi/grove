import { describe, expect, it } from 'vitest'
import { applyEvent, applyReport, unknownStatus, type Status } from './contract.ts'

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

  it('derives finished when a report leaves working for idle and keeps idle on repeated idle', () => {
    expect(applyReport({ state: 'working', since: 200 }, { state: 'idle' }, 260)).toEqual({
      state: 'finished',
      since: 260,
    })
    const idleStatus: Status = { state: 'idle', since: 250 }
    expect(applyReport(idleStatus, { state: 'idle' }, 260)).toBe(idleStatus)
  })

  it('maps every OSC report and derives finished from a working or blocked turn', () => {
    const cases: Array<{ from: Status; report: { state: string; kind?: string }; expected: Status }> = [
      { from: idle, report: { state: 'working' }, expected: { state: 'working', since: 200 } },
      { from: idle, report: { state: 'blocked', kind: 'permission' }, expected: { state: 'needs-you', reason: 'permission', since: 200 } },
      { from: idle, report: { state: 'blocked', kind: 'question' }, expected: { state: 'needs-you', reason: 'question', since: 200 } },
      { from: idle, report: { state: 'blocked', kind: 'auth' }, expected: { state: 'needs-you', reason: 'auth', since: 200 } },
      { from: idle, report: { state: 'blocked' }, expected: { state: 'needs-you', reason: 'permission', since: 200 } },
      { from: idle, report: { state: 'error' }, expected: { state: 'needs-you', reason: 'error', since: 200 } },
      { from: idle, report: { state: 'done' }, expected: { state: 'finished', since: 200 } },
      { from: { state: 'working', since: 100 }, report: { state: 'idle' }, expected: { state: 'finished', since: 200 } },
      {
        from: { state: 'needs-you', reason: 'auth', since: 100 },
        report: { state: 'done' },
        expected: { state: 'finished', since: 200 },
      },
      {
        from: { state: 'needs-you', reason: 'permission', since: 100 },
        report: { state: 'idle' },
        expected: { state: 'finished', since: 200 },
      },
    ]

    for (const { from, report, expected } of cases) expect(applyReport(from, report, 200)).toEqual(expected)
  })

  it('ignores clear and unrecognised OSC states', () => {
    const working: Status = { state: 'working', since: 150 }
    expect(applyReport(working, { state: 'clear' }, 200)).toBe(working)
    expect(applyReport(working, { state: 'future-state' }, 200)).toBe(working)
  })

  it('leaves unknown on every real event', () => {
    const stuck = unknownStatus(900)
    expect(applyEvent(stuck, { kind: 'working' }, 1000)).toEqual({ state: 'working', since: 1000 })
    expect(applyEvent(stuck, { kind: 'needs-you', reason: 'permission' }, 1000).state).toBe('needs-you')
    expect(applyEvent(stuck, { kind: 'finished' }, 1000)).toEqual({ state: 'finished', since: 1000 })
    expect(applyEvent(stuck, { kind: 'idle' }, 1000)).toEqual({ state: 'idle', since: 1000 })
  })

  it('never changes state on session', () => {
    expect(applyEvent(idle, { kind: 'session', resumeId: 'abc' }, 999)).toBe(idle)
  })

})
