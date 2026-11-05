import { describe, expect, it } from 'vitest'
import type { DiffCompared, DiffFile } from '../protocol/messages.ts'
import { baseChoices, branchNote, emptyMessage, settled, treeRows } from './diff-model.ts'

const file = (path: string, status: DiffFile['status'] = 'modified'): DiffFile => ({
  path, oldPath: null, status, binary: false, additions: 1, deletions: 0, hunks: [], truncated: false,
})
const compared = (over: Partial<DiffCompared> = {}): DiffCompared => ({
  mode: 'branch', base: null, defaultBase: 'main', onDefault: false, noDefault: false, noOwnCommits: false, ...over,
})

describe('tree rows', () => {
  const files = [file('README.md'), file('src/a/one.ts'), file('src/a/two.ts'), file('src/b.ts'), file('packages/core/deep/x.ts')]

  it('lists folders before files, and joins a folder that only holds a folder', () => {
    const rows = treeRows(files, '', new Set())
    expect(rows.map((r) => `${r.depth}:${r.kind}:${r.kind === 'dir' ? r.name : r.path}`)).toEqual([
      '0:dir:packages/core/deep',
      '1:file:packages/core/deep/x.ts',
      '0:dir:src',
      '1:dir:a',
      '2:file:src/a/one.ts',
      '2:file:src/a/two.ts',
      '1:file:src/b.ts',
      '0:file:README.md',
    ])
  })

  it('keeps a shut folder as one row with its file count', () => {
    const rows = treeRows(files, '', new Set(['src']))
    expect(rows.find((r) => r.path === 'src')).toMatchObject({ kind: 'dir', collapsed: true, files: 3 })
    expect(rows.some((r) => r.path === 'src/b.ts')).toBe(false)
  })

  it('filters by path, case-insensitively, and opens every folder', () => {
    const rows = treeRows(files, 'ONE', new Set(['src', 'src/a']))
    expect(rows.map((r) => r.path)).toEqual(['src/a', 'src/a/one.ts'])
    expect(rows[0]).toMatchObject({ collapsed: false })
  })
})

describe('base choices', () => {
  const refs = { branches: ['main', 'origin/main', 'dev', 'feature', 'origin/old'], current: 'feature', default: 'main' }

  it('lists the default, then recents that still exist, never the current branch', () => {
    expect(baseChoices(refs, ['dev', 'gone', 'feature', 'main'], '')).toEqual([
      { ref: null, name: 'main', kind: 'default' },
      { ref: 'dev', name: 'dev', kind: 'recent' },
    ])
  })

  it('searches local and remote branches, without the current branch or the default twice', () => {
    expect(baseChoices(refs, [], 'o').map((c) => c.name)).toEqual(['origin/old'])
    expect(baseChoices(refs, [], 'ma').map((c) => c.name)).toEqual(['main'])
    expect(baseChoices(refs, [], 'FEAT')).toEqual([])
  })
})

describe('empty messages', () => {
  it('words each mode and where the quick switch goes', () => {
    expect(emptyMessage(compared(), 'branch')).toMatchObject({ text: 'No changes on this branch compared to main.', switchTo: { mode: 'last-commit' } })
    expect(emptyMessage(compared({ base: 'dev' }), 'branch').text).toBe('No changes on this branch compared to dev.')
    expect(emptyMessage(compared(), 'uncommitted')).toMatchObject({ text: 'No uncommitted changes.', switchTo: { mode: 'branch' } })
    expect(emptyMessage(compared(), 'last-commit')).toMatchObject({ text: 'No commits to show.', switchTo: { mode: 'uncommitted' } })
    expect(emptyMessage(compared({ onDefault: true }), 'branch')).toMatchObject({ text: 'No uncommitted changes.', switchTo: { mode: 'last-commit' } })
  })

  it('notes a Branch mode with no main branch only for the default pick', () => {
    expect(branchNote(compared({ noDefault: true }))).toContain('No main branch found')
    expect(branchNote(compared({ noDefault: true, base: 'dev' }))).toBeNull()
  })
})

describe('refresh trigger', () => {
  it('fires when an agent stops working, and not otherwise', () => {
    expect(settled('working', 'idle')).toBe(true)
    expect(settled('working', 'needs-you')).toBe(true)
    expect(settled('working', 'finished')).toBe(true)
    expect(settled('working', 'unknown')).toBe(false)
    expect(settled('idle', 'working')).toBe(false)
    expect(settled(undefined, 'idle')).toBe(false)
  })
})
