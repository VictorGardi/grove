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
})
