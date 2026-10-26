import type { Comment, CommentAnchor, FeatureKey } from '@shared/types'

export const MAX_SENT = 100 // sent comments kept per session

type Out = { ok: true; comments: Comment[]; comment: Comment } | { ok: false; error: string }

// A session's own drafts: what Send sends. Drafts kept on a feature are re-owned to the session before they are sent.
export const draftsOf = (cs: Comment[], sessionId: string) => cs.filter((c) => c.sessionId === sessionId && c.state === 'draft')

// sessionId null: a draft kept on its feature, file anchors only (D3).
export function addComment(cs: Comment[], a: { id: string; sessionId: string | null; feature?: FeatureKey; anchor: CommentAnchor; body: string; now: string }): Out {
  if (a.sessionId === null && (a.anchor.kind !== 'file' || !a.feature)) return { ok: false, error: 'bad-owner' }
  const body = a.body.trim()
  if (!body) return { ok: false, error: 'empty' }
  if (a.sessionId !== null && a.anchor.kind === 'note' && draftsOf(cs, a.sessionId).some((c) => c.anchor.kind === 'note')) return { ok: false, error: 'note-exists' }
  const comment: Comment = {
    id: a.id, sessionId: a.sessionId, ...(a.sessionId === null ? { feature: a.feature } : {}), anchor: a.anchor, body, state: 'draft', orphaned: false,
    createdAt: a.now, updatedAt: a.now, sentAt: null,
  }
  return { ok: true, comments: [...cs, comment], comment }
}

export function updateComment(cs: Comment[], id: string, body: string, now: string): Out {
  const old = cs.find((c) => c.id === id)
  if (!old) return { ok: false, error: 'not-found' }
  if (old.state !== 'draft') return { ok: false, error: 'not-draft' }
  const text = body.trim()
  if (!text) return { ok: false, error: 'empty' }
  const comment = { ...old, body: text, updatedAt: now }
  return { ok: true, comments: cs.map((c) => (c.id === id ? comment : c)), comment }
}

export const removeComment = (cs: Comment[], id: string) => cs.filter((c) => c.id !== id)

export const dropSession = (cs: Comment[], sessionId: string) => cs.filter((c) => c.sessionId !== sessionId)

// Forgets the drafts kept on features of this checkout.
export const dropFeatureProject = (cs: Comment[], projectId: string) => cs.filter((c) => c.sessionId !== null || c.feature?.projectId !== projectId)

// Gives these drafts to a session; a draft kept on a feature leaves its feature (D3).
export const reown = (cs: Comment[], ids: string[], sessionId: string): Comment[] => cs.map((c) => {
  if (!ids.includes(c.id) || c.state !== 'draft') return c
  const { feature: _, ...rest } = c
  return { ...rest, sessionId }
})

// Marks these drafts sent; keeps the newest MAX_SENT sent comments of each affected session.
export function markSent(cs: Comment[], ids: string[], now: string): Comment[] {
  const marked = cs.map((c) => (ids.includes(c.id) && c.state === 'draft' ? { ...c, state: 'sent' as const, sentAt: now } : c))
  const sessions = new Set(marked.flatMap((c) => (ids.includes(c.id) && c.sessionId !== null ? [c.sessionId] : [])))
  const drop = new Set<string>()
  for (const sid of sessions) {
    const sent = marked.filter((c) => c.sessionId === sid && c.state === 'sent')
      .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
    for (const c of sent.slice(MAX_SENT)) drop.add(c.id)
  }
  return drop.size ? marked.filter((c) => !drop.has(c.id)) : marked
}
