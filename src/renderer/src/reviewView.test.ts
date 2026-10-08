import { describe, expect, it } from 'vitest'
import type { Comment, CommentAnchor } from '@shared/types'
import { draftsByLine, groupForTray } from './reviewView'

const mk = (id: string, anchor: CommentAnchor, state: Comment['state'] = 'draft'): Comment => ({
  id, sessionId: 's', anchor, body: id, state, orphaned: false, createdAt: '', updatedAt: '', sentAt: null,
})
const diff = (path: string, side: 'old' | 'new', start: number, end: number): CommentAnchor =>
  ({ kind: 'diff', root: '/p', path, side, start, end, lines: [] })

describe('draftsByLine', () => {
  it('keys drafts by the last line of their range, for one file, drafts only', () => {
    const cs = [mk('a', diff('x.ts', 'new', 3, 5)), mk('b', diff('x.ts', 'old', 7, 7)), mk('c', diff('y.ts', 'new', 5, 5)),
      mk('d', diff('x.ts', 'new', 5, 5), 'sent'), mk('n', { kind: 'note' })]
    const m = draftsByLine(cs, 'x.ts')
    expect([...m.keys()].sort()).toEqual(['x.ts:new:5', 'x.ts:old:7'])
    expect(m.get('x.ts:new:5')!.map((c) => c.id)).toEqual(['a'])
  })
})

describe('groupForTray', () => {
  it('groups drafts by file in the order of their first comment, leaving out notes and sent', () => {
    const cs = [mk('a', diff('x.ts', 'new', 1, 1)), mk('n', { kind: 'note' }), mk('b', diff('y.ts', 'new', 1, 1)),
      mk('c', diff('x.ts', 'new', 9, 9)), mk('d', diff('z.ts', 'new', 1, 1), 'sent')]
    expect(groupForTray(cs).map((g) => [g.label, g.comments.map((c) => c.id)])).toEqual([['x.ts', ['a', 'c']], ['y.ts', ['b']]])
  })
})
