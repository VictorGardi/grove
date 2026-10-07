import path from 'node:path'
import type { Comment, CommentAnchor } from '@shared/types'

export interface FormatContext {
  projectPath: string
  featurePath(slug: string): string | null // a feature's folder, for artifact paths
}

type Anchored = Comment & { anchor: Extract<CommentAnchor, { kind: 'diff' }> }

// Project-relative when inside the project, else absolute.
function shownPath(file: string, projectPath: string): string {
  const rel = path.relative(projectPath, file)
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : file
}

function diffBlock(c: Anchored): string {
  const { side, start, end, lines } = c.anchor
  const where = `L${start === end ? start : `${start}-${end}`} (${side === 'old' ? 'removed' : 'new'})`
  return [`${where}:`, ...lines.map((l) => `> ${l}`), c.body].join('\n')
}

// The message sent to a session (design: Message format). Artifact comments are added by slice 4.
export function formatReview(drafts: Comment[], ctx: FormatContext): string {
  const parts = [`Review comments from Grove (${drafts.length}). Please address each one.`]
  const note = drafts.find((c) => c.anchor.kind === 'note')
  if (note) parts.push(note.body)
  const files = new Map<string, string[]>() // shown path → blocks, in the order of each file's first comment
  for (const c of drafts) {
    if (c.anchor.kind !== 'diff') continue
    const file = shownPath(path.join(c.anchor.root, c.anchor.path), ctx.projectPath)
    files.set(file, [...(files.get(file) ?? []), diffBlock(c as Anchored)])
  }
  for (const [file, blocks] of files) parts.push(`## ${file}\n${blocks.join('\n\n')}`)
  return parts.join('\n\n')
}
