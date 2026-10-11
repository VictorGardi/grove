import { describe, expect, it } from 'vitest'
import type { Comment, CommentAnchor } from '@shared/types'
import { formatReview } from './format'

const ctx = { projectPath: '/p', checkouts: [{ id: 'p', name: 'grove', path: '/p' }] }
const note = (body: string): Comment => ({
  id: 'n', sessionId: 's', anchor: { kind: 'note' }, body, state: 'draft', orphaned: false,
  createdAt: '', updatedAt: '', sentAt: null,
})

describe('formatReview', () => {
  it('sends a general note under a counted header', () => {
    expect(formatReview([note('Please\nreply pong')], ctx)).toBe(
      'Review comments from Grove (1). Please address each one.\n\nPlease\nreply pong'
    )
  })

  const diff = (over: Partial<Extract<CommentAnchor, { kind: 'diff' }>>, body: string): Comment => ({
    ...note(body),
    anchor: { kind: 'diff', root: '/p', path: 'src/a.ts', side: 'new', start: 120, end: 122, lines: ['const x = 1', 'const y = 2', 'x + y'], ...over },
  })

  it('diff range, removed lines, path outside project', () => {
    const out = formatReview([
      note('Overall: tidy up'),
      diff({}, 'Rename x'),
      diff({ side: 'old', start: 7, end: 7, lines: ['old()'] }, 'Why removed?'),
      diff({ root: '/other', path: 'lib/b.ts', start: 3, end: 3, lines: ['z'] }, 'Check z'),
      diff({ start: 130, end: 131, lines: ['q', 'r'] }, 'Second here'),
    ], ctx)
    expect(out).toBe([
      'Review comments from Grove (5). Please address each one.',
      '',
      'Overall: tidy up',
      '',
      '## src/a.ts (grove)',
      'L120-122 (new):',
      '> const x = 1',
      '> const y = 2',
      '> x + y',
      'Rename x',
      '',
      'L7 (removed):',
      '> old()',
      'Why removed?',
      '',
      'L130-131 (new):',
      '> q',
      '> r',
      'Second here',
      '',
      '## /other/lib/b.ts',
      'L3 (new):',
      '> z',
      'Check z',
    ].join('\n'))
  })

  it('orphaned diff draft is marked', () => {
    const out = formatReview([{ ...diff({ start: 3, end: 3, lines: ['z'] }, 'Check z'), orphaned: true }], ctx)
    expect(out).toContain('> z\nCheck z (The lines have changed since this comment was written.)')
  })

  it('names the checkout a diff belongs to, wherever its root is', () => {
    const both = { ...ctx, checkouts: [...ctx.checkouts, { id: 'wt', name: 'grove · fix-auth', path: '/wt' }] }
    const out = formatReview([
      diff({}, 'In the checkout'),
      diff({ root: '/wt', path: 'src/b.ts' }, 'In the worktree'),
      diff({ root: '/elsewhere', path: 'lib/c.ts' }, 'No such checkout'),
    ], both)
    // the session's own diff is named, a diff rooted in another checkout is named *and* relative to
    // that checkout, and a root matching no configured checkout keeps today's absolute, unnamed path
    expect(out).toContain('## src/a.ts (grove)')
    expect(out).toContain('## src/b.ts (grove · fix-auth)')
    expect(out).toContain('## /elsewhere/lib/c.ts')
    expect(out).not.toContain('..')
  })

  const art = (over: Partial<Extract<CommentAnchor, { kind: 'file' }>>, body: string, orphaned = false): Comment => ({
    ...note(body), orphaned,
    anchor: { kind: 'file', projectId: 'p', path: 'docs/work/f/03-design.md', exact: 'the quoted text', prefix: '', suffix: '', start: 40, end: 41, ...over },
  })

  it('gives the same relative path in two checkouts two sections, each naming its own', () => {
    // ArtifactViewer.tsx:37 attaches a draft to the focused session while the anchor comes from the
    // global viewer, so one message can hold one relative path from two checkouts of one repo.
    const both = { ...ctx, checkouts: [
      { id: 'p', name: 'grove', path: '/p' },
      { id: 'wt', name: 'grove · fix-auth', path: '/wt' },
    ] }
    const out = formatReview([
      art({}, 'in the checkout'),
      art({ projectId: 'wt' }, 'in the worktree'),
    ], both)
    expect(out).toBe([
      'Review comments from Grove (2). Please address each one.',
      '',
      '## docs/work/f/03-design.md (grove)',
      'L40-41, on "the quoted text":',
      'in the checkout',
      '',
      '## docs/work/f/03-design.md (grove · fix-auth)',
      'L40-41, on "the quoted text":',
      'in the worktree',
    ].join('\n'))
    expect(out).not.toContain('..')
  })

  it('keeps two sections when two checkouts are configured under one name', () => {
    const same = { projectPath: '/p', checkouts: [{ id: 'p', name: 'grove', path: '/p' }, { id: 'q', name: 'grove', path: '/q' }] }
    const out = formatReview([art({}, 'one'), art({ projectId: 'q' }, 'two')], same)
    expect(out.match(/^## docs\/work\/f\/03-design\.md/gm)).toHaveLength(2)
    expect(out).toContain('one\n\n## docs/work/f/03-design.md (grove)\nL40-41, on "the quoted text":\ntwo')
  })

  it('names no checkout for a file anchor whose project is not configured', () => {
    expect(formatReview([art({ projectId: 'gone' }, 'x')], ctx)).toContain('## docs/work/f/03-design.md\n')
  })
  const actx = ctx

  it('file quote', () => {
    const long = 'x'.repeat(250)
    const out = formatReview([
      art({}, 'Too vague'), art({ start: 5, end: 5, exact: long }, 'Cut', true), art({ path: 'a.md' }, 'Other file'),
    ], actx)
    expect(out).toBe([
      'Review comments from Grove (3). Please address each one.',
      '',
      '## docs/work/f/03-design.md (grove)',
      'L40-41, on "the quoted text":',
      'Too vague',
      '',
      `L5, on "${'x'.repeat(200)}…":`,
      'Cut (The text has changed since this comment was written.)',
      '',
      '## a.md (grove)',
      'L40-41, on "the quoted text":',
      'Other file',
    ].join('\n'))
  })
})
