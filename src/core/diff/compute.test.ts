import { describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import { gitRepo } from '../testing/gitRepo'
import { computeDiff } from './compute'
import { gitRunner } from './git'

const git = gitRunner('git', process.env)
const project = (dir: string): Project => ({ id: 'p', name: 'proj', path: dir })
const compute = (dir: string, over: Partial<Parameters<typeof computeDiff>[0]> = {}) =>
  computeDiff({ sessionId: 's', dir, project: project(dir), features: [], git, ...over })

describe('computeDiff', () => {
  it('diffs an edited tracked file against HEAD', async () => {
    const r = gitRepo()
    r.write('a.txt', 'one\ntwo\nthree\n')
    r.commit()
    r.write('a.txt', 'one\nTWO\nthree\n')
    const { key, diff } = await compute(r.dir)
    expect(diff).toMatchObject({ sessionId: 's', projectId: 'p', state: 'ok', error: null, truncated: false })
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0]).toMatchObject({ path: 'a.txt', status: 'modified', additions: 1, deletions: 1 })
    expect(diff.files[0].hunks[0].lines.filter((l) => l.kind !== 'context')).toEqual([
      { kind: 'del', text: 'two', old: 2, new: null },
      { kind: 'add', text: 'TWO', old: null, new: 2 },
    ])
    expect((await compute(r.dir)).key).toBe(key)
  })

  it('runs from a subfolder at the repo root', async () => {
    const r = gitRepo()
    r.write('sub/b.txt', 'x\n')
    r.commit()
    r.write('top.txt', 'x\n')
    r.git('add', 'top.txt')
    const { diff } = await compute(`${r.dir}/sub`)
    expect(diff.files.map((f) => f.path)).toEqual(['top.txt'])
  })

  it('gives no files for a clean repo', async () => {
    const r = gitRepo()
    r.write('a.txt', 'x\n')
    r.commit()
    const { diff } = await compute(r.dir)
    expect(diff.state).toBe('ok')
    expect(diff.files).toEqual([])
  })

  it('lists untracked text files as all added, binaries without lines, and skips ignored files', async () => {
    const r = gitRepo()
    r.write('.gitignore', 'ignored.txt\n')
    r.commit()
    r.write('new.md', 'a\nb\n')
    r.write('img.bin', Buffer.from([1, 0, 2]))
    r.write('ignored.txt', 'x\n')
    const { diff } = await compute(r.dir)
    expect(diff.files.map((f) => [f.path, f.status, f.binary])).toEqual([['img.bin', 'untracked', true], ['new.md', 'untracked', false]])
    expect(diff.files[0].hunks).toEqual([])
    expect(diff.files[1]).toMatchObject({ additions: 2, deletions: 0 })
    expect(diff.files[1].hunks).toEqual([{ header: '@@ -0,0 +1,2 @@', oldStart: 0, newStart: 1, lines: [
      { kind: 'add', text: 'a', old: null, new: 1 },
      { kind: 'add', text: 'b', old: null, new: 2 },
    ] }])
  })

  it('changes the key when an untracked file changes', async () => {
    const r = gitRepo()
    r.commit()
    r.write('new.md', 'a\n')
    const before = await compute(r.dir)
    r.write('new.md', 'a\nbb\n')
    expect((await compute(r.dir)).key).not.toBe(before.key)
  })
})
