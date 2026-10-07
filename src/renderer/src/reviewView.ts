import type { Comment } from '@shared/types'

export interface TrayGroup { label: string; comments: Comment[] }

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

// Drafts with a place (not the note), grouped by file in the order of each file's first comment.
export function groupForTray(cs: Comment[]): TrayGroup[] {
  const groups = new Map<string, Comment[]>()
  for (const c of cs) {
    if (c.state !== 'draft' || c.anchor.kind === 'note') continue
    const label = c.anchor.kind === 'artifact' ? `${c.anchor.slug}/${c.anchor.path}` : c.anchor.path
    groups.set(label, [...(groups.get(label) ?? []), c])
  }
  return [...groups].map(([label, comments]) => ({ label, comments }))
}
