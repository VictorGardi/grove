import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { newSession } from './sessions'
import { apply, fromSnapshot, statusOf, withContext, withStatus, type Tracker } from './status'
import { NOW } from './testing/setup'

const AT = '2026-10-05T10:05:00.000Z'
const none = new Map<string, string>()

function tracker(over: Partial<Tracker> = {}): Tracker {
  return { running: false, pending: new Map(), idleAt: null, children: new Set(), context: null, ...over }
}

function oc(id: string, ocId: string, over: Partial<Session> = {}): Session {
  return { ...newSession({ projectId: 'p', kind: 'opencode', now: NOW, id, agentSessionId: ocId }), ...over }
}

describe('apply', () => {
  it('tracks a turn starting and ending', () => {
    const started = apply(new Map(), none, { type: 'exec-started', sessionId: 'ses_a' })
    expect(started.get('ses_a')).toEqual(tracker({ running: true }))
    const ended = apply(started, none, { type: 'exec-ended', sessionId: 'ses_a', at: AT })
    expect(ended.get('ses_a')).toEqual(tracker({ idleAt: AT }))
    expect(started.get('ses_a')?.running).toBe(true) // input not mutated
  })

  it('ignores a child session starting or ending a turn', () => {
    const t = new Map([['ses_root', tracker({ running: true })]])
    const roots = new Map([['ses_child', 'ses_root']])
    expect(apply(t, roots, { type: 'exec-started', sessionId: 'ses_child' })).toBe(t)
    expect(apply(t, roots, { type: 'exec-ended', sessionId: 'ses_child', at: AT })).toBe(t)
  })

  it('opens and closes pending items, a child counting for its root', () => {
    const roots = new Map([['ses_child', 'ses_root']])
    const open = apply(new Map(), roots, { type: 'pending', sessionId: 'ses_child', id: 'per_1', kind: 'permission', open: true })
    expect([...open.get('ses_root')!.pending]).toEqual([['per_1', 'permission']])
    const closed = apply(open, roots, { type: 'pending', sessionId: 'ses_child', id: 'per_1', kind: 'permission', open: false })
    expect(closed.get('ses_root')!.pending.size).toBe(0)
    expect(open.get('ses_root')!.pending.size).toBe(1) // input not mutated
  })

  it('records a child on its root', () => {
    const out = apply(new Map(), new Map([['ses_mid', 'ses_root']]), { type: 'child', sessionId: 'ses_leaf', parentId: 'ses_mid' })
    expect([...out.get('ses_root')!.children]).toEqual(['ses_leaf'])
  })

  it('leaves the map alone on connection events', () => {
    const t = new Map([['ses_a', tracker()]])
    expect(apply(t, none, { type: 'connected', version: 'v' })).toBe(t)
    expect(apply(t, none, { type: 'disconnected' })).toBe(t)
  })
})

describe('statusOf', () => {
  it('is idle without a tracker or turn, working while running', () => {
    expect(statusOf(undefined, null)).toEqual({ status: 'idle' })
    expect(statusOf(tracker(), null)).toEqual({ status: 'idle' })
    expect(statusOf(tracker({ running: true }), null)).toEqual({ status: 'working' })
  })

  it('waits on a permission before a question before working', () => {
    const both = new Map<string, 'permission' | 'question'>([['frm_1', 'question'], ['per_1', 'permission']])
    expect(statusOf(tracker({ running: true, pending: both }), null)).toEqual({ status: 'waiting', waitingFor: 'permission' })
    expect(statusOf(tracker({ running: true, pending: new Map([['frm_1', 'question']]) }), null))
      .toEqual({ status: 'waiting', waitingFor: 'question' })
  })
})

describe('withStatus', () => {
  const term = { ...newSession({ projectId: 'p', kind: 'terminal', now: NOW, id: 't', agentSessionId: null }) }

  it('sets OpenCode sessions from their trackers while connected, never terminals', () => {
    const out = withStatus([oc('a', 'ses_a'), oc('b', 'ses_b'), term], 'opencode', new Map([['ses_a', tracker({ running: true })]]), true, false)
    expect(out.map((s) => s.status)).toEqual(['working', 'idle', undefined])
    expect('status' in out[2]).toBe(false)
  })

  it('sets and clears waitingFor with the status', () => {
    const waiting = new Map([['ses_a', tracker({ pending: new Map([['per_1', 'permission' as const]]) })]])
    const [w] = withStatus([oc('a', 'ses_a')], 'opencode', waiting, true, false)
    expect(w).toMatchObject({ status: 'waiting', waitingFor: 'permission' })
    const [i] = withStatus([w], 'opencode', new Map(), true, false)
    expect(i.status).toBe('idle')
    expect('waitingFor' in i).toBe(false)
    const [off] = withStatus([w], 'opencode', new Map(), false, false)
    expect('status' in off || 'waitingFor' in off).toBe(false)
  })

  it('removes status when disconnected', () => {
    const out = withStatus([oc('a', 'ses_a', { status: 'working' })], 'opencode', new Map(), false, false)
    expect('status' in out[0]).toBe(false)
  })

  it('leaves sessions of other kinds alone', () => {
    const claude = { ...oc('c', 'u-1'), kind: 'claude' as const, status: 'working' as const }
    const [out] = withStatus([claude], 'opencode', new Map([['u-1', tracker()]]), true, false)
    expect(out).toBe(claude)
  })

  it('needsEvent: no status until the session has a tracker', () => {
    const claude = (id: string, aid: string) => ({ ...oc(id, aid), kind: 'claude' as const })
    const out = withStatus([claude('a', 'u-a'), claude('b', 'u-b')], 'claude', new Map([['u-a', tracker()]]), true, true)
    expect(out.map((s) => s.status)).toEqual(['idle', undefined])
  })

  it('returns the same array when nothing changed', () => {
    const list = [oc('a', 'ses_a', { status: 'idle' }), term]
    expect(withStatus(list, 'opencode', new Map(), true, false)).toBe(list)
    const off = [term]
    expect(withStatus(off, 'opencode', new Map(), false, false)).toBe(off)
  })
})

describe('fromSnapshot', () => {
  const snap = (over = {}) => ({ running: false, idleAt: null, pending: [], children: [], ...over })

  it('builds root trackers with their children\'s pending items', () => {
    const snaps = new Map([
      ['ses_a', snap({ running: true, idleAt: AT, pending: [{ id: 'per_1', kind: 'permission' as const }], children: ['ses_c', 'ses_x'] })],
      ['ses_c', snap({ running: true, pending: [{ id: 'frm_1', kind: 'question' as const }] })],
    ])
    const { trackers, roots } = fromSnapshot(snaps, ['ses_a', 'ses_missing'])
    expect(trackers.get('ses_a')).toEqual(tracker({
      running: true,
      idleAt: AT,
      children: new Set(['ses_c', 'ses_x']),
      pending: new Map([['per_1', 'permission'], ['frm_1', 'question']]),
    }))
    expect(trackers.has('ses_missing')).toBe(false)
    expect(trackers.has('ses_c')).toBe(false)
    expect(roots).toEqual(new Map([['ses_c', 'ses_a'], ['ses_x', 'ses_a']]))
  })
})

describe('statusOf: finished turns', () => {
  const BEFORE = '2026-10-05T10:00:00.000Z'
  const AFTER = '2026-10-05T10:10:00.000Z'

  it('shows a finished turn as waiting until seen', () => {
    expect(statusOf(tracker({ idleAt: AT }), null)).toEqual({ status: 'waiting', waitingFor: 'done' })
    expect(statusOf(tracker({ idleAt: AT }), BEFORE)).toEqual({ status: 'waiting', waitingFor: 'done' })
    expect(statusOf(tracker({ idleAt: AT }), AFTER)).toEqual({ status: 'idle' })
    expect(statusOf(tracker({ idleAt: AT }), AT)).toEqual({ status: 'idle' })
  })

  it('ranks working and pending items above done', () => {
    expect(statusOf(tracker({ idleAt: AT, running: true }), null)).toEqual({ status: 'working' })
    expect(statusOf(tracker({ idleAt: AT, pending: new Map([['frm_1', 'question']]) }), null))
      .toEqual({ status: 'waiting', waitingFor: 'question' })
  })

  it('reads each session\'s seenAt in withStatus', () => {
    const t = new Map([['ses_a', tracker({ idleAt: AT })], ['ses_b', tracker({ idleAt: AT })]])
    const out = withStatus([oc('a', 'ses_a'), oc('b', 'ses_b', { seenAt: AFTER })], 'opencode', t, true, false)
    expect(out.map((s) => s.waitingFor ?? s.status)).toEqual(['done', 'idle'])
  })
})

describe('context', () => {
  const ctx = { pct: 19, tokens: 190300, window: 1000000, model: 'm' }
  const claude = (over: Partial<Session> = {}): Session => ({ ...newSession({ projectId: 'p', kind: 'claude', now: NOW, id: 'a', agentSessionId: 'u' }), ...over })

  it('apply stores a reading on the tracker, creating it if needed', () => {
    const t = apply(new Map(), none, { type: 'context', sessionId: 'u', context: ctx })
    expect(t.get('u')).toEqual(tracker({ context: ctx }))
    const next = apply(new Map([['u', tracker({ running: true })]]), none, { type: 'context', sessionId: 'u', context: ctx })
    expect(next.get('u')).toEqual(tracker({ running: true, context: ctx }))
  })

  it('fromSnapshot carries the snapshot reading', () => {
    const snap = { running: false, idleAt: null, pending: [], children: [], context: ctx }
    expect(fromSnapshot(new Map([['u', snap]]), ['u']).trackers.get('u')?.context).toEqual(ctx)
  })

  it('withContext sets live fields and lastContext from the tracker', () => {
    const [s] = withContext([claude()], 'claude', new Map([['u', tracker({ context: ctx })]]), true)
    expect(s).toMatchObject({ contextPct: 19, contextTokens: 190300, contextWindow: 1000000, model: 'm', lastContext: { pct: 19, tokens: 190300, window: 1000000 } })
  })

  it('a null percentage shows "unknown" live but keeps the last reading', () => {
    const last = { pct: 40, tokens: 1, window: 2 }
    const unknown = { pct: null, tokens: null, window: 200000, model: 'm' }
    const [s] = withContext([claude({ lastContext: last })], 'claude', new Map([['u', tracker({ context: unknown })]]), true)
    expect(s).toMatchObject({ contextPct: null, contextTokens: null, contextWindow: 200000, lastContext: last })
  })

  it('drops the live fields when disconnected, keeping lastContext; never touches terminals or other kinds', () => {
    const live = withContext([claude()], 'claude', new Map([['u', tracker({ context: ctx })]]), true)
    const [s] = withContext(live, 'claude', new Map(), false)
    expect(s.lastContext).toEqual({ pct: 19, tokens: 190300, window: 1000000 })
    for (const k of ['contextPct', 'contextTokens', 'contextWindow', 'model']) expect(k in s).toBe(false)
    const term = newSession({ projectId: 'p', kind: 'terminal', now: NOW, id: 't', agentSessionId: null })
    expect(withContext([term, oc('o', 'x')], 'claude', new Map(), true)).toEqual([term, oc('o', 'x')])
  })

  it('returns the same array when nothing changed', () => {
    const t = new Map([['u', tracker({ context: ctx })]])
    const once = withContext([claude()], 'claude', t, true)
    expect(withContext(once, 'claude', t, true)).toBe(once)
    const sessions = [claude()]
    expect(withContext(sessions, 'claude', new Map(), true)).toBe(sessions)
  })
})
