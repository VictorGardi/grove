import type { DiffFile, DiffLine, SessionDiff } from '@shared/types'

export function visibleFiles(d: SessionDiff, showUntracked: boolean): DiffFile[] {
  return showUntracked ? d.files : d.files.filter((f) => f.status !== 'untracked')
}

// A line's identity (design): add → new side, del → old side, context → new side.
export function lineKey(path: string, l: DiffLine): string {
  return l.kind === 'del' ? `${path}:old:${l.old}` : `${path}:new:${l.new}`
}
