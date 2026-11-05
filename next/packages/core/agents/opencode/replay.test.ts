import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyEvent, unknownStatus, type Status, type StatusEvent } from '../../status/contract.ts'
import { emptyFold, normalise, statusFor, type OpenCodeFold } from './normalise.ts'

// Replays a recorded session (the fixture's envelopes, one per line) through the same steps the hub runs:
// the events of the watched session only, folded into a status with each envelope's own time.
const SESSION = 'ses_a'
const lines = fs.readFileSync(new URL('./fixtures/permission-run.jsonl', import.meta.url), 'utf8').split('\n').filter((l) => l.trim() !== '')

function replay(source: string[], sessionId: string): { state: string; reason?: string; since: number }[] {
  let fold: OpenCodeFold = emptyFold()
  let status: Status = unknownStatus(0)
  const states: { state: string; reason?: string; since: number }[] = []
  for (const line of source) {
    const raw = JSON.parse(line) as { created: number }
    const event = normalise(raw, '2.0.20')
    if (!event || event.type === 'connected' || event.type === 'child' || event.sessionId !== sessionId) continue
    const step = statusFor(fold, event)
    fold = step.fold
    for (const e of step.events as StatusEvent[]) {
      status = applyEvent(status, e, raw.created)
      const reason = status.state === 'needs-you' ? status.reason : undefined
      states.push({ state: status.state, reason, since: status.since })
    }
  }
  return states
}

describe('OpenCode status replay', () => {
  it('gives working, needs-you permission, working, finished, in order', () => {
    const states = replay(lines, SESSION)
    expect(states.map((s) => [s.state, s.reason])).toEqual([
      ['working', undefined],
      ['needs-you', 'permission'],
      ['working', undefined],
      ['finished', undefined],
    ])
  })

  it('stamps each change with its own event time', () => {
    const states = replay(lines, SESSION)
    expect(states.map((s) => s.since)).toEqual([1791194400000, 1791194401000, 1791194402000, 1791194403000])
  })

  it('leaves out the child session and the other session', () => {
    const states = replay(lines, 'ses_other')
    expect(states.map((s) => s.state)).toEqual(['working'])
    expect(replay(lines, 'ses_none')).toEqual([])
  })
})
