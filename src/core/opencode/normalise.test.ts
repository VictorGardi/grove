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

  it('maps permission asked and replied', () => {
    expect(normalise(env('permission.asked', { id: 'per_1', sessionID: 'ses_a', action: 'edit', resources: [] }), 'v'))
      .toEqual({ type: 'pending', sessionId: 'ses_a', id: 'per_1', kind: 'permission', open: true })
    expect(normalise(env('permission.replied', { sessionID: 'ses_a', requestID: 'per_1', reply: 'once' }), 'v'))
      .toEqual({ type: 'pending', sessionId: 'ses_a', id: 'per_1', kind: 'permission', open: false })
  })

  it('maps forms to questions, with the session id inside the form on create', () => {
    expect(normalise(env('form.created', { form: { id: 'frm_1', sessionID: 'ses_a', metadata: { kind: 'question' } } }), 'v'))
      .toEqual({ type: 'pending', sessionId: 'ses_a', id: 'frm_1', kind: 'question', open: true })
    for (const t of ['form.replied', 'form.cancelled']) {
      expect(normalise(env(t, { id: 'frm_1', sessionID: 'ses_a' }), 'v'))
        .toEqual({ type: 'pending', sessionId: 'ses_a', id: 'frm_1', kind: 'question', open: false })
    }
    expect(normalise(env('form.cancelled', { form: { id: 'frm_1', sessionID: 'ses_a' } }), 'v'))
      .toMatchObject({ id: 'frm_1', sessionId: 'ses_a', open: false })
  })

  it('maps a subagent session.created to child, and ignores top-level ones', () => {
    expect(normalise(env('session.created', { sessionID: 'ses_c', parentID: 'ses_a' }), 'v'))
      .toEqual({ type: 'child', sessionId: 'ses_c', parentId: 'ses_a' })
    expect(normalise(env('session.created', { info: { id: 'ses_c', parentID: 'ses_a' } }), 'v'))
      .toEqual({ type: 'child', sessionId: 'ses_c', parentId: 'ses_a' })
    expect(normalise(env('session.created', { sessionID: 'ses_c' }), 'v')).toBeNull()
  })

  it('ignores pending events without ids', () => {
    expect(normalise(env('permission.asked', { sessionID: 'ses_a' }), 'v')).toBeNull()
    expect(normalise(env('form.created', { form: { sessionID: 'ses_a' } }), 'v')).toBeNull()
    expect(normalise(env('permission.replied', { sessionID: 'ses_a' }), 'v')).toBeNull()
  })
})
