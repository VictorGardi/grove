import { describe, expect, it } from 'vitest'
import type { Comment, DocTarget } from '@shared/types'
import { draftsForFile, isCommentable, ownerArgs, parseIframeMessage } from './artifactComments'

const sel = { grove: 1, type: 'select', exact: 'hi', prefix: 'a', suffix: 'b', start: 2, end: 3 }

describe('parseIframeMessage', () => {
  it('accepts the three shapes', () => {
    expect(parseIframeMessage({ grove: 1, type: 'ready' })).toEqual({ type: 'ready' })
    expect(parseIframeMessage({ grove: 1, type: 'open', id: 'x' })).toEqual({ type: 'open', id: 'x' })
    expect(parseIframeMessage(sel)).toMatchObject({ type: 'select', exact: 'hi', start: 2, end: 3 })
  })
  it('rejects bad shapes', () => {
    for (const bad of [null, 'x', {}, { ...sel, grove: 2 }, { ...sel, exact: ' ' }, { ...sel, start: 0 }, { ...sel, end: 1 },
      { ...sel, start: 1.5 }, { ...sel, prefix: 3 }, { ...sel, exact: 'x'.repeat(6000) }, { grove: 1, type: 'open', id: 4 }, { grove: 1, type: 'nope' }]) {
      expect(parseIframeMessage(bad)).toBeNull()
    }
  })
})

const art: DocTarget = { kind: 'file', projectId: 'p', path: 'docs/work/f/03-design.md', hash: null, fromDiff: null }
const draft = (id: string, over: Partial<Comment> = {}): Comment => ({
  id, sessionId: 's', anchor: { kind: 'file', projectId: 'p', path: 'docs/work/f/03-design.md', exact: 'e', prefix: '', suffix: '', start: 1, end: 1 },
  body: 'b', state: 'draft', orphaned: false, createdAt: '', updatedAt: '', sentAt: null, ...over,
})

describe('artifact comments', () => {
  it('any markdown file is commentable, feature folder or not', () => {
    expect(isCommentable(art)).toBe(true)
    expect(isCommentable({ ...art, path: 'x.html' })).toBe(false)
    expect(isCommentable({ kind: 'file', projectId: 'p', path: 'CONTEXT.md', hash: null, fromDiff: null })).toBe(true)
  })
  it('lists the session\'s drafts on the file', () => {
    const cs = [draft('1'), draft('2', { sessionId: 'o' }), draft('3', { state: 'sent' }), draft('4', { anchor: { kind: 'note' } })]
    expect(draftsForFile(cs, { kind: 'session', sessionId: 's' }, art).map((c) => c.id)).toEqual(['1'])
    expect(draftsForFile(cs, null, art)).toEqual([])
  })
  it('a session never sees a feature\'s drafts as its own on the file', () => {
    const cs = [draft('1'), draft('f', { sessionId: null, feature: { projectId: 'p', slug: 'f' } })]
    expect(draftsForFile(cs, { kind: 'session', sessionId: 's' }, art).map((c) => c.id)).toEqual(['1'])
  })
  it('lists a feature\'s own drafts on the file, never a session\'s or another feature\'s', () => {
    const f = { projectId: 'p', slug: 'f' }
    const cs = [draft('1'), draft('2', { sessionId: null, feature: f }), draft('3', { sessionId: null, feature: { projectId: 'p', slug: 'g' } }),
      draft('4', { sessionId: null, feature: { projectId: 'q', slug: 'f' } }), draft('5', { sessionId: null, feature: f, state: 'sent' }),
      draft('6', { sessionId: null, feature: f, anchor: { kind: 'file', projectId: 'p', path: 'docs/work/f/01-questions.md', exact: 'e', prefix: '', suffix: '', start: 1, end: 1 } })]
    expect(draftsForFile(cs, { kind: 'feature', feature: f }, art).map((c) => c.id)).toEqual(['2'])
  })
  it('turns an owner into comment:add\'s fields', () => {
    expect(ownerArgs({ kind: 'session', sessionId: 's' })).toEqual({ sessionId: 's' })
    expect(ownerArgs({ kind: 'feature', feature: { projectId: 'p', slug: 'f' } })).toEqual({ sessionId: null, feature: { projectId: 'p', slug: 'f' } })
  })
})
