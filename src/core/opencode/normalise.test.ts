import { describe, expect, it } from 'vitest'
import { childIds, lastWritesOf, normalise, patchPaths, snapshotOf, toolWrites, unwrap } from './normalise'

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
  const blank = { running: false, idleAt: null, pending: [], children: [] }
  const info = (time: unknown) => ({ id: 'ses_a', time })

  it('is blank for a session OpenCode does not know yet', () => {
    expect(snapshotOf(null, { ses_a: { type: 'running' } }, [], [])).toEqual(blank)
  })

  it('reads running from the active map and idle time as ISO', () => {
    expect(snapshotOf(info({ idle: 1791194400000 }), { ses_a: { type: 'running' } }, [], []))
      .toEqual({ ...blank, running: true, idleAt: new Date(1791194400000).toISOString() })
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

const PATCH = [
  '*** Begin Patch',
  '*** Add File: docs/work/a/new.md',
  '+hello',
  '*** Update File: src/x.ts',
  '*** Move to: docs/work/b/x.ts',
  '@@',
  '*** Delete File: old.md ',
  '*** End Patch',
].join('\n')

describe('patchPaths', () => {
  it('reads every file header, in order', () => {
    expect(patchPaths(PATCH)).toEqual(['docs/work/a/new.md', 'src/x.ts', 'docs/work/b/x.ts', 'old.md'])
    expect(patchPaths(42)).toEqual([])
  })
})

describe('toolWrites', () => {
  const tool = (type: string, id: string, extra: object = {}) => env(`session.tool.${type}`, { sessionID: 'ses_a', assistantMessageID: 'msg_1', id, ...extra })
  const run = (name: string, input: unknown, end = 'success') => {
    const t = toolWrites()
    return [t(tool('input.started', 'call_1', { name })), t(tool('called', 'call_1', { input })), t(tool(end, 'call_1'))]
  }

  it.each([['write'], ['edit']])('emits wrote when %s succeeds', (name) => {
    expect(run(name, { path: 'docs/x.md' })).toEqual([null, null, { type: 'wrote', sessionId: 'ses_a', paths: ['docs/x.md'] }])
  })

  it('reads a patch\'s paths from its headers', () => {
    expect(run('patch', { patchText: PATCH })[2]).toEqual({ type: 'wrote', sessionId: 'ses_a', paths: patchPaths(PATCH) })
  })

  it('ignores reads, failures and unknown calls', () => {
    expect(run('read', { path: 'docs/x.md' })[2]).toBe(null)
    expect(run('write', { path: 'docs/x.md' }, 'failed')[2]).toBe(null)
    const t = toolWrites()
    expect(t(tool('success', 'call_9'))).toBe(null)
    expect(t(env('session.step.started', {}))).toBe(null)
  })

  it('forgets a call once it failed', () => {
    const t = toolWrites()
    t(tool('input.started', 'call_1', { name: 'write' }))
    t(tool('called', 'call_1', { input: { path: 'x' } }))
    t(tool('failed', 'call_1'))
    expect(t(tool('success', 'call_1'))).toBe(null)
  })
})

describe('lastWritesOf', () => {
  const item = (name: string, input: unknown, state: object = { content: [{ type: 'text', text: 'ok' }] }) =>
    ({ type: 'tool', id: `call_${name}`, name, state: { input, ...state } })
  const msg = (...content: unknown[]) => ({ id: 'msg', type: 'assistant', content })

  it('finds the latest completed write, newest message first and last item first', () => {
    const messages = [
      msg(item('read', { path: 'docs/r.md' })),
      msg(item('write', { path: 'docs/old.md' }), item('edit', { path: 'docs/new.md' })),
      msg(item('write', { path: 'docs/older.md' })),
    ]
    expect(lastWritesOf(messages)).toEqual(['docs/new.md'])
  })

  it('skips errored and running calls, reads patches, and returns null when none', () => {
    expect(lastWritesOf([msg(item('write', { path: 'a' }, { error: 'boom', content: [] }), item('write', { path: 'b' }, {}))])).toBe(null)
    expect(lastWritesOf([msg(item('write', { path: 'a' }, { status: 'completed' }))])).toEqual(['a'])
    expect(lastWritesOf([msg(item('patch', { patchText: PATCH }))])).toEqual(patchPaths(PATCH))
    expect(lastWritesOf([{ type: 'user', content: 'hi' }, null])).toBe(null)
  })
})
