import { describe, expect, it } from 'vitest'
import type { Comment } from '@shared/types'
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
})
