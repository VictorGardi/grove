import type { Result } from './ipc'
import type { Session } from './types'

// Session groups: a session may have a parent, and groups are one level deep, so every parent is
// a root and every child has no children. Both rules live here so the CLI, the picker and the
// create path cannot disagree about them.

// The session that leads `id`'s group: its parent when it has one that still exists, else itself.
// A session spawned by a child is a sibling of that child, not its grandchild.
export function leaderOf(sessions: Session[], id: string): Session | null {
  const s = sessions.find((x) => x.id === id)
  if (!s) return null
  return (s.parentId && sessions.find((x) => x.id === s.parentId)) || s
}

export const hasChildren = (sessions: Session[], id: string) => sessions.some((x) => x.parentId === id)

// Who a session with parent `wanted` would actually be a child of, or why it cannot be one.
// `id` is the session being placed, absent for one not created yet.
export function resolveParent(sessions: Session[], wanted: string, id?: string): Result<string> {
  const leader = leaderOf(sessions, wanted)
  if (!leader) return { ok: false, error: 'no-parent' }
  if (id !== undefined) {
    if (leader.id === id) return { ok: false, error: 'same-session' }
    if (hasChildren(sessions, id)) return { ok: false, error: 'is-parent' }
  }
  return { ok: true, data: leader.id }
}

// `id` placed under `wanted`'s group leader, or taken out of its group with null.
export function withParent(sessions: Session[], id: string, wanted: string | null): Result<Session[]> {
  if (!sessions.some((x) => x.id === id)) return { ok: false, error: 'not-found' }
  let parentId: string | null = null
  if (wanted !== null) {
    const r = resolveParent(sessions, wanted, id)
    if (!r.ok) return r
    parentId = r.data
  }
  return { ok: true, data: sessions.map((x) => (x.id === id ? { ...x, parentId } : x)) }
}

// Sessions whose parent is in `gone` are promoted to top level, nothing else changes. Same array when none is.
export function orphanChildren(sessions: Session[], gone: string[]): Session[] {
  if (!sessions.some((x) => x.parentId && gone.includes(x.parentId))) return sessions
  return sessions.map((x) => (x.parentId && gone.includes(x.parentId) ? { ...x, parentId: null } : x))
}

// Whether `candidate` may be offered as a parent for `id` in the picker.
export const canParent = (sessions: Session[], id: string, candidate: Session) =>
  candidate.id !== id && !candidate.parentId && !hasChildren(sessions, id)
