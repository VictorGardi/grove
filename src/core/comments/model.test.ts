import { describe, expect, it } from 'vitest'
import type { Comment } from '@shared/types'
import { addComment, draftsOf, dropFeatureProject, dropSession, markSent, MAX_SENT, removeComment, reown, updateComment } from './model'

const T = '2026-10-07T10:00:00.000Z'
const add = (cs: Comment[], id: string, body = 'x', sessionId = 's') => {
  const r = addComment(cs, { id, sessionId, anchor: { kind: 'note' }, body, now: T })
  if (!r.ok) throw new Error(r.error)
  return r.comments
}
const fileAnchor = { kind: 'file' as const, projectId: 'p', path: 'docs/work/f/03-design.md', exact: 'q', prefix: '', suffix: '', start: 1, end: 1 }
const F = { projectId: 'p', slug: 'f' }
const addKept = (cs: Comment[], id: string, feature = F) => {
  const r = addComment(cs, { id, sessionId: null, feature, anchor: fileAnchor, body: id, now: T })
  if (!r.ok) throw new Error(r.error)
  return r.comments
}

describe('addComment', () => {
  it('trims the body and starts a draft', () => {
    const r = addComment([], { id: 'a', sessionId: 's', anchor: { kind: 'note' }, body: '  hi \n', now: T })
    expect(r).toMatchObject({ ok: true, comment: { id: 'a', body: 'hi', state: 'draft', orphaned: false, sentAt: null, createdAt: T } })
  })
  it('rejects an empty body', () => {
    expect(addComment([], { id: 'a', sessionId: 's', anchor: { kind: 'note' }, body: '  ', now: T })).toEqual({ ok: false, error: 'empty' })
  })
  it('allows one draft note per session', () => {
    const cs = add([], 'a')
    expect(addComment(cs, { id: 'b', sessionId: 's', anchor: { kind: 'note' }, body: 'y', now: T })).toEqual({ ok: false, error: 'note-exists' })
    expect(add(cs, 'c', 'y', 'other')).toHaveLength(2)
  })
  it('allows a new note once the old one is sent', () => {
    const cs = markSent(add([], 'a'), ['a'], T)
    expect(add(cs, 'b')).toHaveLength(2)
  })
})

describe('addComment kept on a feature', () => {
  it('stores the feature only when there is no session', () => {
    expect(addKept([], 'a')[0]).toMatchObject({ sessionId: null, feature: F, state: 'draft' })
    const r = addComment([], { id: 'b', sessionId: 's', feature: F, anchor: fileAnchor, body: 'x', now: T })
    expect(r.ok && 'feature' in r.comment).toBe(false)
  })
  it('refuses a null owner on a note or diff anchor, or without a feature', () => {
    const diff = { kind: 'diff' as const, root: '/r', path: 'a', side: 'new' as const, start: 1, end: 1, lines: ['x'] }
    expect(addComment([], { id: 'a', sessionId: null, feature: F, anchor: { kind: 'note' }, body: 'x', now: T })).toEqual({ ok: false, error: 'bad-owner' })
    expect(addComment([], { id: 'a', sessionId: null, feature: F, anchor: diff, body: 'x', now: T })).toEqual({ ok: false, error: 'bad-owner' })
    expect(addComment([], { id: 'a', sessionId: null, anchor: fileAnchor, body: 'x', now: T })).toEqual({ ok: false, error: 'bad-owner' })
  })
  it('is never a session draft', () => {
    expect(draftsOf(addKept(add([], 'a'), 'k'), 's').map((c) => c.id)).toEqual(['a'])
  })
})

describe('updateComment', () => {
  it('changes a draft body', () => {
    const r = updateComment(add([], 'a'), 'a', ' new ', '2026-10-07T11:00:00.000Z')
    expect(r).toMatchObject({ ok: true, comment: { body: 'new', updatedAt: '2026-10-07T11:00:00.000Z', createdAt: T } })
  })
  it('refuses a sent comment, an unknown id and an empty body', () => {
    const sent = markSent(add([], 'a'), ['a'], T)
    expect(updateComment(sent, 'a', 'y', T)).toEqual({ ok: false, error: 'not-draft' })
    expect(updateComment(sent, 'zz', 'y', T)).toEqual({ ok: false, error: 'not-found' })
    expect(updateComment(add([], 'a'), 'a', ' ', T)).toEqual({ ok: false, error: 'empty' })
  })
})

describe('remove and drop', () => {
  it('removes one comment, or a whole session', () => {
    const cs = add(add([], 'a'), 'b', 'y', 'other')
    expect(removeComment(cs, 'a').map((c) => c.id)).toEqual(['b'])
    expect(dropSession(cs, 'other').map((c) => c.id)).toEqual(['a'])
  })
  it('drops the drafts kept on features of one checkout only', () => {
    const cs = addKept(addKept(add([], 'a'), 'k'), 'q', { projectId: 'q', slug: 'f' })
    expect(dropFeatureProject(cs, 'p').map((c) => c.id)).toEqual(['a', 'q'])
    expect(dropSession(cs, 's').map((c) => c.id)).toEqual(['k', 'q'])
  })
})

describe('reown', () => {
  it('gives the given drafts to a session and drops their feature', () => {
    const cs = reown(addKept(addKept(add([], 'a', 'x', 'other'), 'k'), 'j'), ['k', 'a'], 's')
    expect(cs.map((c) => [c.id, c.sessionId, 'feature' in c])).toEqual([['a', 's', false], ['k', 's', false], ['j', null, true]])
    expect(draftsOf(cs, 's').map((c) => c.id)).toEqual(['a', 'k'])
  })
  it('leaves sent comments alone', () => {
    const cs = markSent(add([], 'a'), ['a'], T)
    expect(reown(cs, ['a'], 'z')).toEqual(cs)
  })
})

describe('markSent', () => {
  it('marks the given drafts and leaves the rest', () => {
    const cs = markSent(add(add([], 'a'), 'b', 'y', 'other'), ['a'], T)
    expect(cs.map((c) => [c.id, c.state, c.sentAt])).toEqual([['a', 'sent', T], ['b', 'draft', null]])
    expect(draftsOf(cs, 's')).toEqual([])
  })
  it('keeps the newest MAX_SENT sent comments per session', () => {
    let cs: Comment[] = []
    for (let i = 0; i < MAX_SENT + 2; i++) {
      cs = add(cs, `c${i}`)
      cs = markSent(cs, [`c${i}`], new Date(Date.parse(T) + i * 1000).toISOString())
    }
    const ids = cs.map((c) => c.id)
    expect(ids).toHaveLength(MAX_SENT)
    expect(ids).not.toContain('c0')
    expect(ids).toContain(`c${MAX_SENT + 1}`)
  })
  it('does not prune drafts kept on a feature', () => {
    let cs: Comment[] = []
    for (let i = 0; i < MAX_SENT + 2; i++) cs = addKept(cs, `k${i}`)
    cs = markSent(cs, cs.map((c) => c.id), T)
    expect(cs).toHaveLength(MAX_SENT + 2)
  })
})
