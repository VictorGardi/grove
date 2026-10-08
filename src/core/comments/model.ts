import type { Comment, CommentAnchor } from '@shared/types'

export const MAX_SENT = 100 // sent comments kept per session

type Out = { ok: true; comments: Comment[]; comment: Comment } | { ok: false; error: string }

export const draftsOf = (cs: Comment[], sessionId: string) => cs.filter((c) => c.sessionId === sessionId && c.state === 'draft')

export function addComment(cs: Comment[], a: { id: string; sessionId: string; anchor: CommentAnchor; body: string; now: string }): Out {
  const body = a.body.trim()
  if (!body) return { ok: false, error: 'empty' }
  if (a.anchor.kind === 'note' && draftsOf(cs, a.sessionId).some((c) => c.anchor.kind === 'note')) return { ok: false, error: 'note-exists' }
  const comment: Comment = {
    id: a.id, sessionId: a.sessionId, anchor: a.anchor, body, state: 'draft', orphaned: false,
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

// Marks these drafts sent; keeps the newest MAX_SENT sent comments of each affected session.
export function markSent(cs: Comment[], ids: string[], now: string): Comment[] {
  const marked = cs.map((c) => (ids.includes(c.id) && c.state === 'draft' ? { ...c, state: 'sent' as const, sentAt: now } : c))
  const sessions = new Set(marked.filter((c) => ids.includes(c.id)).map((c) => c.sessionId))
  const drop = new Set<string>()
  for (const sid of sessions) {
    const sent = marked.filter((c) => c.sessionId === sid && c.state === 'sent')
      .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
    for (const c of sent.slice(MAX_SENT)) drop.add(c.id)
  }
  return drop.size ? marked.filter((c) => !drop.has(c.id)) : marked
}
