import type { CommentsFile } from '@shared/types'
import { atomicWrite, readVersioned } from '../store/jsonFile'

export function loadComments(file: string, onBad?: (msg: string) => void): CommentsFile {
  return readVersioned<CommentsFile>(file, 1, { schemaVersion: 1, comments: [] }, onBad)
}

export function saveComments(file: string, f: CommentsFile): void {
  atomicWrite(file, JSON.stringify(f, null, 2) + '\n')
}
