import { describe, expect, it } from 'vitest'
import type { Comment, DocTarget } from '@shared/types'
import { draftsForFile, isCommentable, parseIframeMessage } from './artifactComments'

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
    expect(draftsForFile(cs, 's', art).map((c) => c.id)).toEqual(['1'])
    expect(draftsForFile(cs, null, art)).toEqual([])
  })
})
