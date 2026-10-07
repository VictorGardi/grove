import { describe, expect, it } from 'vitest'
import type { Comment } from '@shared/types'
import { addComment, draftsOf, dropSession, markSent, MAX_SENT, removeComment, updateComment } from './model'

const T = '2026-10-07T10:00:00.000Z'
const add = (cs: Comment[], id: string, body = 'x', sessionId = 's') => {
  const r = addComment(cs, { id, sessionId, anchor: { kind: 'note' }, body, now: T })
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
})
