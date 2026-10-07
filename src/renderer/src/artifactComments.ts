import type { Comment, CommentAnchor, DocTarget } from '@shared/types'

type ArtifactAnchor = Extract<CommentAnchor, { kind: 'artifact' }>

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

// Comments only on feature-folder markdown.
export const isCommentable = (t: DocTarget): t is Extract<DocTarget, { kind: 'artifact' }> =>
  t.kind === 'artifact' && t.path.toLowerCase().endsWith('.md')

export const artifactAnchor = (t: Extract<DocTarget, { kind: 'artifact' }>, m: Extract<IframeMessage, { type: 'select' }>): ArtifactAnchor => ({
  kind: 'artifact', projectId: t.projectId, slug: t.slug, path: t.path,
  exact: m.exact, prefix: m.prefix, suffix: m.suffix, start: m.start, end: m.end,
})

// A session's draft comments on one artifact file.
export function draftsForFile(cs: Comment[], sessionId: string | null, t: DocTarget): Comment[] {
  if (!sessionId || t.kind !== 'artifact') return []
  return cs.filter((c) => c.sessionId === sessionId && c.state === 'draft' && c.anchor.kind === 'artifact'
    && c.anchor.projectId === t.projectId && c.anchor.slug === t.slug && c.anchor.path === t.path)
}
