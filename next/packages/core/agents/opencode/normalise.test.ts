import { describe, expect, it } from 'vitest'
import { childIds, emptyFold, normalise, snapshotOf, statusFor, statusOfSnapshot, unwrap, type OpenCodeFold } from './normalise.ts'

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

describe('unwrap', () => {
  it('takes data out of the envelope, else returns the body', () => {
    expect(unwrap({ data: [1] })).toEqual([1])
    expect(unwrap([1])).toEqual([1])
    expect(unwrap(null)).toBe(null)
  })
})

describe('childIds', () => {
  it('reads ids from an array or an items list', () => {
    expect(childIds([{ id: 'ses_c' }, { id: 1 }, null])).toEqual(['ses_c'])
    expect(childIds({ items: [{ id: 'ses_d' }] })).toEqual(['ses_d'])
    expect(childIds('nope')).toEqual([])
  })
})

describe('snapshotOf', () => {
  const blank = { known: false, running: false, idleAt: null, pending: [], children: [] }
  const info = (time: unknown) => ({ id: 'ses_a', time })

  it('is blank for a session OpenCode does not know yet', () => {
    expect(snapshotOf(null, { ses_a: { type: 'running' } }, [], [])).toEqual(blank)
  })

  it('reads running from the active map and idle time as ISO', () => {
    expect(snapshotOf(info({ idle: 1791194400000 }), { ses_a: { type: 'running' } }, [], []))
      .toEqual({ ...blank, known: true, running: true, idleAt: new Date(1791194400000).toISOString() })
    expect(snapshotOf(info({ idle: '2026-10-05T10:00:00.000Z' }), {}, [], []).idleAt).toBe('2026-10-05T10:00:00.000Z')
    expect(snapshotOf(info({}), {}, [], []).idleAt).toBe(null)
  })

  it('lists pending permissions, then forms as questions', () => {
    expect(snapshotOf(info({}), {}, [{ id: 'per_1' }, { x: 1 }], [{ id: 'frm_1' }]).pending).toEqual([
      { id: 'per_1', kind: 'permission' },
      { id: 'frm_1', kind: 'question' },
    ])
    expect(snapshotOf(info({}), {}, 'bad', null).pending).toEqual([])
  })
})

// Folds a list of events in order, collecting the status events each step gives.
function run(events: Parameters<typeof statusFor>[1][], fold: OpenCodeFold = emptyFold()) {
  const out: unknown[] = []
  let f = fold
  for (const e of events) {
    const step = statusFor(f, e)
    f = step.fold
    out.push(...step.events)
  }
  return { out, fold: f }
}

const started = { type: 'exec-started', sessionId: 'ses_a' } as const
const ended = (sessionId = 'ses_a') => ({ type: 'exec-ended', sessionId, at: '2026-10-06T08:00:00.000Z' }) as const
const asked = (kind: 'permission' | 'question', id = 'per_1') => ({ type: 'pending', sessionId: 'ses_a', id, kind, open: true }) as const
const closed = (kind: 'permission' | 'question', id = 'per_1') => ({ type: 'pending', sessionId: 'ses_a', id, kind, open: false }) as const

describe('statusFor', () => {
  it('maps an execution start to working and an end to finished, for succeeded, failed and interrupted alike', () => {
    expect(run([started]).out).toEqual([{ kind: 'working' }])
    expect(run([started, ended()]).out).toEqual([{ kind: 'working' }, { kind: 'finished' }])
  })

  it('maps an open permission or question to needs-you with its reason', () => {
    expect(run([started, asked('permission')]).out.at(-1)).toEqual({ kind: 'needs-you', reason: 'permission' })
    expect(run([started, asked('question', 'frm_1')]).out.at(-1)).toEqual({ kind: 'needs-you', reason: 'question' })
  })

  it('goes back to working when the open item is closed while the turn runs', () => {
    expect(run([started, asked('permission'), closed('permission')]).out.at(-1)).toEqual({ kind: 'working' })
  })

  it('stays needs-you while another item is still open', () => {
    const { out } = run([started, asked('permission', 'per_1'), asked('question', 'frm_1'), closed('question', 'frm_1')])
    expect(out.at(-1)).toEqual({ kind: 'needs-you', reason: 'permission' })
  })

  it('says nothing when an item closes outside a running turn', () => {
    expect(run([closed('permission')]).out).toEqual([])
    expect(run([started, ended(), closed('permission')]).out).toEqual([{ kind: 'working' }, { kind: 'finished' }])
  })

  it('drops the open items of an ended execution, so a late reply changes nothing', () => {
    const { fold } = run([started, asked('permission')])
    expect(fold.pending.size).toBe(1)
    const after = run([ended()], fold)
    expect(after.fold.pending.size).toBe(0)
    expect(run([closed('permission')], after.fold).out).toEqual([])
  })

  it('ignores a child session and another session', () => {
    expect(run([{ type: 'child', sessionId: 'ses_c', parentId: 'ses_a' }]).out).toEqual([])
    expect(run([{ type: 'connected', version: '2.0.20' }]).out).toEqual([])
  })
})

describe('statusOfSnapshot', () => {
  const snap = (over: object = {}) => ({ known: true, running: false, idleAt: null, pending: [], children: [], ...over })

  it('reads an open item as needs-you, the first one by kind', () => {
    expect(statusOfSnapshot(emptyFold(), snap({ running: true, pending: [{ id: 'frm_1', kind: 'question' }, { id: 'per_1', kind: 'permission' }] })).events)
      .toEqual([{ kind: 'needs-you', reason: 'question' }])
  })

  it('reads a running turn as working', () => {
    expect(statusOfSnapshot(emptyFold(), snap({ running: true })).events).toEqual([{ kind: 'working' }])
  })

  it('reads a turn that stopped while working or waiting as idle-prompt', () => {
    const working = run([started]).fold
    expect(statusOfSnapshot(working, snap()).events).toEqual([{ kind: 'idle-prompt' }])
    const waiting = run([started, asked('permission')]).fold
    expect(statusOfSnapshot(waiting, snap()).events).toEqual([{ kind: 'idle-prompt' }])
  })

  it('reads an idle snapshot as idle-prompt even when the fold is fresh, as after a core restart', () => {
    expect(statusOfSnapshot(emptyFold(), snap()).events).toEqual([{ kind: 'idle-prompt' }])
  })

  it('reads a turn that ended during downtime as idle-prompt, so the restored working is not kept', () => {
    const restored = { ...emptyFold(), reported: 'working' as const }
    expect(statusOfSnapshot(restored, snap()).events).toEqual([{ kind: 'idle-prompt' }])
  })

  it('says nothing for a session OpenCode does not know yet', () => {
    expect(statusOfSnapshot(emptyFold(), { ...snap(), known: false }).events).toEqual([])
  })

  it('still says idle-prompt for a finished session, which the service leaves finished', () => {
    expect(statusOfSnapshot(run([started, ended()]).fold, snap()).events).toEqual([{ kind: 'idle-prompt' }])
  })
})
