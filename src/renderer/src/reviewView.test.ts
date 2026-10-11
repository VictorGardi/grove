import { describe, expect, it } from 'vitest'
import type { Comment, CommentAnchor, Project } from '@shared/types'
import { draftsByLine, groupForTray } from './reviewView'

const mk = (id: string, anchor: CommentAnchor, state: Comment['state'] = 'draft'): Comment => ({
  id, sessionId: 's', anchor, body: id, state, orphaned: false, createdAt: '', updatedAt: '', sentAt: null,
})
const diff = (path: string, side: 'old' | 'new', start: number, end: number, root = '/p'): CommentAnchor =>
  ({ kind: 'diff', root, path, side, start, end, lines: [] })
const art = (projectId: string, path: string): CommentAnchor =>
  ({ kind: 'file', projectId, path, exact: 'q', prefix: '', suffix: '', start: 1, end: 1 })

const project = (id: string, name: string, path = '/' + id, worktreeOf?: string): Project =>
  ({ id, name, path, ...(worktreeOf && { worktreeOf }) })

// A checkout and a worktree of one repo, as grove registers them.
const projects = [project('p', 'grove'), project('wt', 'grove · fix-auth', '/wt', 'p')]

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
  const shape = (cs: Comment[], over: Project[] = projects) =>
    groupForTray(cs, over).map((g) => [g.label, g.comments.map((c) => c.id)])

  it('groups drafts by file in the order of their first comment, leaving out notes and sent', () => {
    const cs = [mk('a', diff('x.ts', 'new', 1, 1)), mk('n', { kind: 'note' }), mk('b', diff('y.ts', 'new', 1, 1)),
      mk('c', diff('x.ts', 'new', 9, 9)), mk('d', diff('z.ts', 'new', 1, 1), 'sent')]
    expect(shape(cs)).toEqual([['x.ts (grove)', ['a', 'c']], ['y.ts (grove)', ['b']]])
  })

  it('gives the same relative path in two checkouts two groups, each naming its own', () => {
    const cs = [mk('a', art('p', 'docs/work/x/03-design.md')), mk('b', art('wt', 'docs/work/x/03-design.md'))]
    expect(shape(cs)).toEqual([
      ['docs/work/x/03-design.md (grove)', ['a']],
      ['docs/work/x/03-design.md (grove · fix-auth)', ['b']],
    ])
  })

  it('keeps a checkout group and a worktree group apart for a diff draft too', () => {
    const cs = [mk('a', diff('src/a.ts', 'new', 1, 1)), mk('b', diff('src/a.ts', 'new', 4, 4, '/wt'))]
    expect(shape(cs)).toEqual([['src/a.ts (grove)', ['a']], ['src/a.ts (grove · fix-auth)', ['b']]])
  })

  it('still groups one checkout\'s drafts of one path together', () => {
    const cs = [mk('a', art('p', 'docs/x.md')), mk('b', art('p', 'docs/x.md'))]
    expect(shape(cs)).toEqual([['docs/x.md (grove)', ['a', 'b']]])
  })

  it('separates two checkouts configured under one name, which their labels cannot', () => {
    const same = [project('p', 'grove'), project('q', 'grove')]
    const groups = groupForTray([mk('a', art('p', 'docs/x.md')), mk('b', art('q', 'docs/x.md'))], same)
    expect(groups.map((g) => g.comments.map((c) => c.id))).toEqual([['a'], ['b']])
    expect(groups[0].id).not.toBe(groups[1].id)
  })

  it('leaves a draft whose checkout is not configured under its bare path', () => {
    expect(shape([mk('a', art('gone', 'docs/x.md'))])).toEqual([['docs/x.md', ['a']]])
    expect(shape([mk('a', diff('x.ts', 'new', 1, 1, '/elsewhere'))])).toEqual([['x.ts', ['a']]])
  })

  it('is empty with no drafts', () => {
    expect(groupForTray([], projects)).toEqual([])
  })
})