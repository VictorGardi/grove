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

// v2 → v3 (D3): a draft may be kept on its feature with a null session; existing comments pass through.
const v2ToV3 = (f: object) => f

export function loadComments(file: string, onBad?: (msg: string) => void): CommentsFile {
  return readVersioned<CommentsFile>(file, 3, { schemaVersion: 3, comments: [] }, onBad, { 1: v1ToV2, 2: v2ToV3 })
}

export function saveComments(file: string, f: CommentsFile): void {
  atomicWrite(file, JSON.stringify(f, null, 2) + '\n')
}
