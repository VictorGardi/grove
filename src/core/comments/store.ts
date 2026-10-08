import type { CommentsFile } from '@shared/types'
import { atomicWrite, readVersioned } from '../store/jsonFile'

// v1 → v2 (ADR 0032): slug-keyed artifact anchors become project-relative file anchors. The feature folder is
// unknown here, so a sent comment keeps `<slug>/<path>` as its label; unsent drafts are dropped.
const v1ToV2 = (f: { comments?: { state: string; anchor: { kind: string; slug?: string; path?: string } }[] }) => ({
  ...f,
  comments: (f.comments ?? []).flatMap((c) => {
    if (c.anchor.kind !== 'artifact') return [c]
    if (c.state === 'draft') return []
    const { slug, path, ...rest } = c.anchor
    return [{ ...c, anchor: { ...rest, kind: 'file', path: `${slug}/${path}` } }]
  }),
})

export function loadComments(file: string, onBad?: (msg: string) => void): CommentsFile {
  return readVersioned<CommentsFile>(file, 2, { schemaVersion: 2, comments: [] }, onBad, { 1: v1ToV2 })
}

export function saveComments(file: string, f: CommentsFile): void {
  atomicWrite(file, JSON.stringify(f, null, 2) + '\n')
}
