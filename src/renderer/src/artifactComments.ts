import { featureDrafts } from '@shared/comments'
import type { Comment, CommentAnchor, DocTarget, FeatureKey } from '@shared/types'

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

// Who a new comment belongs to: the session it is for, or, with no session, the artifact's feature (design D3).
export type CommentOwner = { kind: 'session'; sessionId: string } | { kind: 'feature'; feature: FeatureKey }

const onFile = (c: Comment, t: DocTarget) => c.anchor.kind === 'file' && c.anchor.projectId === t.projectId && c.anchor.path === t.path

// The owner's draft comments on one file: a session's own, or the feature's own (never a session's).
export function draftsForFile(cs: Comment[], owner: CommentOwner | null, t: DocTarget): Comment[] {
  if (!owner) return []
  if (owner.kind === 'feature') return featureDrafts(cs, owner.feature).filter((c) => onFile(c, t))
  return cs.filter((c) => c.sessionId === owner.sessionId && c.state === 'draft' && onFile(c, t))
}

// comment:add's owner fields.
export const ownerArgs = (o: CommentOwner): { sessionId: string | null; feature?: FeatureKey } =>
  o.kind === 'session' ? { sessionId: o.sessionId } : { sessionId: null, feature: o.feature }
