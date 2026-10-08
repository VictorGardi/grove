import path from 'node:path'
import type { Comment, CommentAnchor } from '@shared/types'

export interface FormatContext {
  projectPath: string
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
  const body = c.orphaned ? `${c.body} (The lines have changed since this comment was written.)` : c.body
  return [`${where}:`, ...lines.map((l) => `> ${l}`), body].join('\n')
}

const QUOTE_MAX = 200

function fileBlock(c: Comment & { anchor: Extract<CommentAnchor, { kind: 'file' }> }): string {
  const { start, end, exact } = c.anchor
  const quote = exact.length > QUOTE_MAX ? `${exact.slice(0, QUOTE_MAX)}…` : exact
  const body = c.orphaned ? `${c.body} (The text has changed since this comment was written.)` : c.body
  return [`L${start === end ? start : `${start}-${end}`}, on "${quote}":`, body].join('\n')
}

// The message sent to a session (design: Message format).
export function formatReview(drafts: Comment[], ctx: FormatContext): string {
  const parts = [`Review comments from Grove (${drafts.length}). Please address each one.`]
  const note = drafts.find((c) => c.anchor.kind === 'note')
  if (note) parts.push(note.body)
  const files = new Map<string, string[]>() // shown path → blocks, in the order of each file's first comment
  for (const c of drafts) {
    let file: string
    let block: string
    if (c.anchor.kind === 'diff') {
      file = shownPath(path.join(c.anchor.root, c.anchor.path), ctx.projectPath)
      block = diffBlock(c as Anchored)
    } else if (c.anchor.kind === 'file') {
      file = c.anchor.path
      block = fileBlock(c as Comment & { anchor: Extract<CommentAnchor, { kind: 'file' }> })
    } else continue
    files.set(file, [...(files.get(file) ?? []), block])
  }
  for (const [file, blocks] of files) parts.push(`## ${file}\n${blocks.join('\n\n')}`)
  return parts.join('\n\n')
}
