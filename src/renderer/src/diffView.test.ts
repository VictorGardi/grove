import { describe, expect, it } from 'vitest'
import type { DiffFile, SessionDiff } from '@shared/types'
import { lineKey, visibleFiles } from './diffView'

const file = (path: string, status: DiffFile['status']): DiffFile =>
  ({ path, oldPath: null, status, binary: false, additions: 0, deletions: 0, hunks: [], truncated: false, rendered: null })
const diff: SessionDiff = {
  sessionId: 's', projectId: 'p', state: 'ok', error: null, root: '/r', truncated: false,
  files: [file('a.ts', 'modified'), file('new.ts', 'untracked'), file('b.ts', 'added')],
}

describe('visibleFiles', () => {
  it('shows untracked files when asked, and hides them otherwise', () => {
    expect(visibleFiles(diff, true).map((f) => f.path)).toEqual(['a.ts', 'new.ts', 'b.ts'])
    expect(visibleFiles(diff, false).map((f) => f.path)).toEqual(['a.ts', 'b.ts'])
  })
})

describe('lineKey', () => {
  it('keys add and context lines by the new side and del lines by the old side', () => {
    expect(lineKey('a.ts', { kind: 'add', text: 'x', old: null, new: 4 })).toBe('a.ts:new:4')
    expect(lineKey('a.ts', { kind: 'context', text: 'x', old: 2, new: 3 })).toBe('a.ts:new:3')
    expect(lineKey('a.ts', { kind: 'del', text: 'x', old: 7, new: null })).toBe('a.ts:old:7')
  })
})
