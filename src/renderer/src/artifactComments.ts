import type { Comment, CommentAnchor, DocTarget } from '@shared/types'

type FileAnchor = Extract<CommentAnchor, { kind: 'file' }>

// What the comment script (ADR 0026) can tell the app; anything else is dropped.
export type IframeMessage =
  | { type: 'ready' }
  | { type: 'select'; exact: string; prefix: string; suffix: string; start: number; end: number }
  | { type: 'open'; id: string }

const MAX_TEXT = 5000

export function parseIframeMessage(data: unknown): IframeMessage | null {
  if (!data || typeof data !== 'object') return null
  const m = data as Record<string, unknown>
  if (m.grove !== 1) return null
  if (m.type === 'ready') return { type: 'ready' }
  if (m.type === 'open') return typeof m.id === 'string' && m.id.length < 100 ? { type: 'open', id: m.id } : null
  if (m.type !== 'select') return null
  const { exact, prefix, suffix, start, end } = m
  if (typeof exact !== 'string' || !exact.trim() || exact.length > MAX_TEXT) return null
  if (typeof prefix !== 'string' || prefix.length > MAX_TEXT || typeof suffix !== 'string' || suffix.length > MAX_TEXT) return null
  if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 1 || (end as number) < (start as number)) return null
  return { type: 'select', exact, prefix, suffix, start: start as number, end: end as number }
}

// Comments on any rendered markdown file.
export const isCommentable = (t: DocTarget): boolean => t.path.toLowerCase().endsWith('.md')

export const fileAnchor = (t: DocTarget, m: Extract<IframeMessage, { type: 'select' }>): FileAnchor => ({
  kind: 'file', projectId: t.projectId, path: t.path,
  exact: m.exact, prefix: m.prefix, suffix: m.suffix, start: m.start, end: m.end,
})

// A session's draft comments on one file.
export function draftsForFile(cs: Comment[], sessionId: string | null, t: DocTarget): Comment[] {
  if (!sessionId) return []
  return cs.filter((c) => c.sessionId === sessionId && c.state === 'draft' && c.anchor.kind === 'file'
    && c.anchor.projectId === t.projectId && c.anchor.path === t.path)
}
