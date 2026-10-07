import { describe, expect, it } from 'vitest'
import type { Comment, CommentAnchor } from '@shared/types'
import { formatReview } from './format'

const ctx = { projectPath: '/p', featurePath: () => null }
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
      '## src/a.ts',
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
})
