import { describe, expect, it } from 'vitest'
import { normalise } from './normalise'

// Envelopes as OpenCode 2.0.20 sends them on /api/event.
const env = (type: string, data: unknown, created: unknown = 1791194400000) => ({ id: 'evt_1', type, created, data })

describe('normalise', () => {
  it('maps server.connected, carrying the service version', () => {
    expect(normalise(env('server.connected', {}), '2.0.20')).toEqual({ type: 'connected', version: '2.0.20' })
  })

  it('maps execution start', () => {
    expect(normalise(env('session.execution.started', { sessionID: 'ses_a' }), '2.0.20'))
      .toEqual({ type: 'exec-started', sessionId: 'ses_a' })
  })

  it.each(['succeeded', 'failed', 'interrupted'])('maps execution %s to exec-ended', (end) => {
    expect(normalise(env(`session.execution.${end}`, { sessionID: 'ses_a' }), '2.0.20'))
      .toEqual({ type: 'exec-ended', sessionId: 'ses_a', at: new Date(1791194400000).toISOString() })
  })

  it('accepts an ISO created time and falls back to now without one', () => {
    const iso = '2026-10-06T08:00:00.000Z'
    expect(normalise(env('session.execution.succeeded', { sessionID: 'ses_a' }, iso), 'v')).toMatchObject({ at: iso })
    const e = normalise({ type: 'session.execution.succeeded', data: { sessionID: 'ses_a' } }, 'v')
    expect(e?.type === 'exec-ended' && !Number.isNaN(Date.parse(e.at))).toBe(true)
  })

  it('ignores other events and malformed input', () => {
    expect(normalise(env('session.step.started', { sessionID: 'ses_a' }), 'v')).toBeNull()
    expect(normalise(env('session.execution.started', {}), 'v')).toBeNull()
    expect(normalise(env('session.execution.started', null), 'v')).toBeNull()
    expect(normalise('text', 'v')).toBeNull()
    expect(normalise(null, 'v')).toBeNull()
  })
})
