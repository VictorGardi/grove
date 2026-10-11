import type { Comment, CommentAnchor, Project } from '@shared/types'

export interface TrayGroup { id: string; label: string; comments: Comment[] }

// A session's draft diff comments on one file, keyed like diffView's lineKey at the range's last line.
export function draftsByLine(cs: Comment[], path: string): Map<string, Comment[]> {
  const out = new Map<string, Comment[]>()
  for (const c of cs) {
    const a = c.anchor
    if (c.state !== 'draft' || a.kind !== 'diff' || a.path !== path) continue
    const key = `${path}:${a.side}:${a.end}`
    out.set(key, [...(out.get(key) ?? []), c])
  }
  return out
}

// The checkout a draft belongs to: a file anchor names its project, a diff anchor its root — the
// same resolution comments/format.ts makes, for the same reason.
export function checkoutOf(anchor: CommentAnchor, projects: Project[]): Project | null {
  if (anchor.kind === 'file') return projects.find((p) => p.id === anchor.projectId) ?? null
  if (anchor.kind === 'diff') return projects.find((p) => p.path === anchor.root) ?? null
  return null
}

// Drafts with a place (not the note), grouped by file in the order of each file's first comment.
// Grouped by the *checkout* as well as the path, not by the path alone: a session's drafts can span
// a checkout and its worktrees (ArtifactViewer.tsx:37 attaches a draft to the focused session while
// the anchor comes from the global viewer), and one relative path in two checkouts is two files.
// `id` is the grouping key, which the label cannot be — two checkouts may share a name.
export function groupForTray(cs: Comment[], projects: Project[]): TrayGroup[] {
  const groups = new Map<string, TrayGroup>()
  for (const c of cs) {
    if (c.state !== 'draft' || c.anchor.kind === 'note') continue
    const a = c.anchor
    const checkout = checkoutOf(a, projects)
    const id = (a.kind === 'file' ? a.projectId : a.root) + '/' + a.path
    const label = checkout === null ? a.path : `${a.path} (${checkout.name})`
    const at = groups.get(id)
    groups.set(id, { id, label, comments: [...(at?.comments ?? []), c] })
  }
  return [...groups.values()]
}