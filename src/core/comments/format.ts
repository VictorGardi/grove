import path from 'node:path'
import type { Comment, CommentAnchor } from '@shared/types'

// A configured checkout: what an anchor's path is relative to, and what the heading calls it.
export interface Checkout { id: string; name: string; path: string }

export interface FormatContext {
  projectPath: string  // the sending session's own checkout
  checkouts: Checkout[] // every configured checkout, so a path is relative to — and named by — its own
}

type Anchored = Comment & { anchor: Extract<CommentAnchor, { kind: 'diff' }> }

// Project-relative when inside the checkout it names, else absolute. The checkout's name is part of
// the heading, so the agent knows which directory to resolve the path in — and a path that walks
// out of its checkout with `..` is never shown, because the base is always the checkout it names.
function shownPath(file: string, basePath: string, name: string | null): string {
  const rel = path.relative(basePath, file)
  const shown = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : file
  return name === null ? shown : `${shown} (${name})`
}

// The checkout an anchor belongs to: a diff's root, or the project a file anchor was made in.
function checkoutOf(anchor: CommentAnchor, ctx: FormatContext): Checkout | null {
  if (anchor.kind === 'file') return ctx.checkouts.find((c) => c.id === anchor.projectId) ?? null
  if (anchor.kind === 'diff') return ctx.checkouts.find((c) => c.path === anchor.root) ?? null
  return null
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

// The message sent to a session (design: Message format). A session's drafts can span checkouts —
// the viewer is global while the draft attaches to the focused session, ArtifactViewer.tsx:37 — so
// each section is keyed by the checkout its path came from, not by the path alone. Keying by the
// shown string would let two checkouts configured under one name merge into one section.
export function formatReview(drafts: Comment[], ctx: FormatContext): string {
  const parts = [`Review comments from Grove (${drafts.length}). Please address each one.`]
  const note = drafts.find((c) => c.anchor.kind === 'note')
  if (note) parts.push(note.body)
  const files = new Map<string, { heading: string; blocks: string[] }>() // checkout + path → section
  for (const c of drafts) {
    let key: string
    let heading: string
    let block: string
    const checkout = checkoutOf(c.anchor, ctx)
    const name = checkout?.name ?? null
    if (c.anchor.kind === 'diff') {
      const base = checkout?.path ?? ctx.projectPath
      heading = shownPath(path.join(c.anchor.root, c.anchor.path), base, name)
      key = `${c.anchor.root}/${c.anchor.path}`
      block = diffBlock(c as Anchored)
    } else if (c.anchor.kind === 'file') {
      heading = shownPath(c.anchor.path, checkout?.path ?? ctx.projectPath, name)
      key = `${c.anchor.projectId}/${c.anchor.path}`
      block = fileBlock(c as Comment & { anchor: Extract<CommentAnchor, { kind: 'file' }> })
    } else continue
    const at = files.get(key)
    files.set(key, { heading, blocks: [...(at?.blocks ?? []), block] })
  }
  for (const { heading, blocks } of files.values()) parts.push(`## ${heading}\n${blocks.join('\n\n')}`)
  return parts.join('\n\n')
}