import type { Comment } from '@shared/types'

export interface FormatContext {
  projectPath: string
  featurePath(slug: string): string | null // a feature's folder, for artifact paths
}

// The message sent to a session (design: Message format). Anchored comments are added by slices 2 and 4.
export function formatReview(drafts: Comment[], _ctx: FormatContext): string {
  const parts = [`Review comments from Grove (${drafts.length}). Please address each one.`]
  const note = drafts.find((c) => c.anchor.kind === 'note')
  if (note) parts.push(note.body)
  return parts.join('\n\n')
}
