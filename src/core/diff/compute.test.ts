import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import { gitRepo } from '../testing/gitRepo'
import { computeDiff } from './compute'
import { gitRunner } from './git'

const git = gitRunner('git', process.env)
const project = (dir: string): Project => ({ id: 'p', name: 'proj', path: dir })
const compute = (dir: string, over: Partial<Parameters<typeof computeDiff>[0]> = {}) =>
  computeDiff({ sessionId: 's', dir, project: project(dir), git, ...over })

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
    const { diff } = await compute(`${r.dir}/sub`, { project: project(r.dir) })
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

  it('reports a folder outside any repo as not-git', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-plain-'))
    expect(await compute(dir)).toEqual({ key: 'not-git', diff: expect.objectContaining({ state: 'not-git', root: null, files: [] }) })
  })

  it('diffs a repo without commits against the empty tree', async () => {
    const r = gitRepo()
    r.write('a.txt', 'x\n')
    r.git('add', 'a.txt')
    r.write('b.txt', 'y\n')
    const { diff } = await compute(r.dir)
    expect(diff.state).toBe('ok')
    expect(diff.files.map((f) => [f.path, f.status])).toEqual([['a.txt', 'added'], ['b.txt', 'untracked']])
  })

  it('shows a git mv as a rename', async () => {
    const r = gitRepo()
    r.write('old.md', 'same\ncontent\nhere\n')
    r.commit()
    r.git('mv', 'old.md', 'new.md')
    const { diff } = await compute(r.dir)
    expect(diff.files).toEqual([expect.objectContaining({ path: 'new.md', oldPath: 'old.md', status: 'renamed', hunks: [] })])
  })

  it('cuts a file whose patch is over 1 MB', async () => {
    const r = gitRepo()
    r.write('big.txt', 'a\n')
    r.write('small.txt', 'a\n')
    r.commit()
    r.write('big.txt', 'x'.repeat(99) + '\n'.repeat(1) + ('y'.repeat(99) + '\n').repeat(11_000))
    r.write('small.txt', 'b\n')
    const { diff } = await compute(r.dir)
    expect(diff.files.map((f) => [f.path, f.truncated, f.hunks.length])).toEqual([['big.txt', true, 0], ['small.txt', false, 1]])
    expect(diff.truncated).toBe(false)
  })

  it('lists files past 20 000 lines without their lines', async () => {
    const r = gitRepo()
    r.commit()
    r.write('a.txt', 'l\n'.repeat(20_001))
    r.write('b.txt', 'm\n')
    r.git('add', '-A')
    const { diff } = await compute(r.dir)
    expect(diff.truncated).toBe(true)
    expect(diff.files.map((f) => [f.path, f.truncated, f.hunks.length])).toEqual([['a.txt', false, 1], ['b.txt', true, 0]])
  })

  it('reports git not found', async () => {
    const r = gitRepo()
    expect((await compute(r.dir, { git: null })).diff).toMatchObject({ state: 'error', error: 'git not found' })
  })

  it('opens a changed viewable file in a feature folder rendered, and nothing else', async () => {
    const r = gitRepo() // under the tmpdir symlink: the feature path isn't the real path
    r.write('docs/work/x/feature.md', '# x\n')
    r.write('docs/work/x/03-design.md', 'a\n')
    r.write('docs/work/x/old.md', 'a\n')
    r.write('src/a.ts', 'a\n')
    r.commit()
    r.write('docs/work/x/03-design.md', 'b\n')
    r.write('docs/work/x/refs/new.html', '<p>x</p>\n')
    r.write('src/a.ts', 'b\n')
    r.git('rm', '-q', 'docs/work/x/old.md')
    const { diff } = await compute(r.dir)
    expect(diff.files.map((f) => [f.path, f.rendered])).toEqual([
      ['docs/work/x/03-design.md', { path: 'docs/work/x/03-design.md' }],
      ['docs/work/x/old.md', null],
      ['src/a.ts', null],
      ['docs/work/x/refs/new.html', { path: 'docs/work/x/refs/new.html' }],
    ])
  })

  it('opens a changed viewable file elsewhere in the project as a project file', async () => {
    const r = gitRepo()
    r.write('docs/adr/0001.md', 'a\n')
    r.write('.github/notes.md', 'a\n')
    r.commit()
    r.write('docs/adr/0001.md', 'b\n')
    r.write('.github/notes.md', 'b\n')
    const { diff } = await compute(r.dir)
    expect(diff.files.map((f) => [f.path, f.rendered])).toEqual([
      ['.github/notes.md', null],
      ['docs/adr/0001.md', { path: 'docs/adr/0001.md' }],
    ])
  })

  it('scopes the diff to the project when it is a subfolder of the repo, and maps its files relative to it', async () => {
    const r = gitRepo()
    r.write('app/CONTEXT.md', 'a\n')
    r.write('README.md', 'a\n')
    r.commit()
    r.write('app/CONTEXT.md', 'b\n')
    r.write('README.md', 'b\n') // outside the project: not in its diff at all
    const sub = path.join(r.dir, 'app')
    const { diff } = await compute(sub, { project: project(sub) })
    expect(diff.files.map((f) => [f.path, f.rendered])).toEqual([
      ['app/CONTEXT.md', { path: 'CONTEXT.md' }],
    ])
  })

  it('excludes a sibling project\'s untracked files from the diff (monorepo: two projects, one repo)', async () => {
    const r = gitRepo()
    r.write('infra/a.txt', 'a\n')
    r.write('web/b.txt', 'b\n')
    r.commit()
    r.write('infra/new.txt', 'x\n') // untracked, inside the project
    r.write('web/new.txt', 'x\n') // untracked, in a sibling project
    const { diff } = await compute(path.join(r.dir, 'infra'), { project: project(path.join(r.dir, 'infra')) })
    expect(diff.files.map((f) => f.path)).toEqual(['infra/new.txt'])
  })

  it('given a base, diffs since it forked from the base instead of against HEAD', async () => {
    const r = gitRepo()
    r.write('a.txt', 'one\n')
    r.commit()
    r.git('checkout', '-b', 'feature')
    r.write('a.txt', 'one\ntwo\n')
    r.commit('on feature') // fully committed: a plain HEAD diff shows nothing
    const plain = await compute(r.dir, { mode: 'uncommitted' })
    expect(plain.diff.files).toEqual([])
    const { diff } = await compute(r.dir, { base: 'main' })
    expect(diff.base).toBe('main')
    expect(diff.files.map((f) => f.path)).toEqual(['a.txt'])
  })

  it('still shows uncommitted changes on top of a base', async () => {
    const r = gitRepo()
    r.commit()
    r.git('checkout', '-b', 'feature')
    r.write('a.txt', 'committed\n')
    r.commit()
    r.write('a.txt', 'committed\nand uncommitted\n')
    const { diff } = await compute(r.dir, { base: 'main' })
    expect(diff.files.map((f) => f.path)).toEqual(['a.txt'])
    expect(diff.files[0].additions).toBe(2)
  })

  it('falls back to diffing against the base ref itself when it shares no history with HEAD', async () => {
    const r = gitRepo()
    r.write('a.txt', 'x\n')
    r.commit()
    r.git('checkout', '--orphan', 'other')
    r.git('rm', '-rf', '-q', '.')
    r.write('b.txt', 'y\n')
    r.commit('unrelated root')
    r.git('checkout', 'main')
    const { diff } = await compute(r.dir, { base: 'other' })
    expect(diff.state).toBe('ok')
    expect(diff.base).toBe('other')
    expect(diff.files.map((f) => [f.path, f.status])).toEqual([['a.txt', 'added'], ['b.txt', 'deleted']])
  })

  it('changes the key when only the base changes', async () => {
    const r = gitRepo()
    r.write('a.txt', 'one\n')
    r.commit()
    r.git('checkout', '-b', 'feature')
    r.write('a.txt', 'one\ntwo\n')
    r.commit()
    const plain = await compute(r.dir, { mode: 'uncommitted' })
    const sinceMain = await compute(r.dir, { base: 'main' })
    expect(sinceMain.key).not.toBe(plain.key)
  })
})

describe('computeDiff default branch view', () => {
  const featureRepo = () => {
    const r = gitRepo()
    r.write('a.txt', 'one\n')
    r.commit()
    r.git('checkout', '-q', '-b', 'feature')
    r.write('a.txt', 'one\ntwo\n')
    r.commit('on feature')
    return r
  }

  it('shows the branch work against the detected main branch with no base given', async () => {
    const r = featureRepo()
    r.write('new.txt', 'x\n')
    const { diff } = await compute(r.dir)
    expect(diff.files.map((f) => f.path)).toEqual(['a.txt', 'new.txt'])
    expect(diff.base).toBe('main')
    expect(diff.compared).toEqual({ mode: 'branch', base: 'main', defaultBase: 'main', onDefault: false, noDefault: false, noOwnCommits: false })
  })

  it('reports noOwnCommits when the branch has nothing past main', async () => {
    const r = gitRepo()
    r.write('a.txt', 'one\n')
    r.commit()
    r.git('checkout', '-q', '-b', 'feature')
    const { diff } = await compute(r.dir)
    expect(diff.files).toEqual([])
    expect(diff.compared).toMatchObject({ base: 'main', onDefault: false, noOwnCommits: true })
  })

  it('on the main branch shows only uncommitted changes and says so', async () => {
    const r = gitRepo()
    r.write('a.txt', 'one\n')
    r.commit()
    r.write('a.txt', 'one\nedit\n')
    const { diff } = await compute(r.dir)
    expect(diff.files.map((f) => f.path)).toEqual(['a.txt'])
    expect(diff.compared).toMatchObject({ mode: 'branch', base: null, defaultBase: 'main', onDefault: true, noDefault: false, noOwnCommits: false })
  })

  it('uses origin/<name> when the default branch has no local ref', async () => {
    const r = featureRepo()
    r.git('update-ref', 'refs/remotes/origin/main', 'main')
    r.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    r.git('branch', '-q', '-D', 'main')
    const { diff } = await compute(r.dir)
    expect(diff.state).toBe('ok')
    expect(diff.files.map((f) => f.path)).toEqual(['a.txt'])
    expect(diff.compared).toMatchObject({ defaultBase: 'main', noDefault: false })
  })

  it('reports noDefault, not an error, with no main or master', async () => {
    const r = gitRepo()
    r.write('a.txt', 'one\n')
    r.commit()
    r.git('branch', '-q', '-m', 'trunk')
    r.write('a.txt', 'two\n')
    const { diff } = await compute(r.dir)
    expect(diff.state).toBe('ok')
    expect(diff.files.map((f) => f.path)).toEqual(['a.txt'])
    expect(diff.compared).toMatchObject({ base: null, defaultBase: null, noDefault: true })
  })

  it('reports noDefault when origin/HEAD names a branch with no ref', async () => {
    const r = featureRepo()
    r.git('update-ref', 'refs/remotes/origin/gone', 'main')
    r.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/gone')
    r.git('update-ref', '-d', 'refs/remotes/origin/gone')
    const { diff } = await compute(r.dir)
    expect(diff.state).toBe('ok')
    expect(diff.compared).toMatchObject({ noDefault: true, base: null })
  })

  it('reports noDefault on a detached HEAD', async () => {
    const r = featureRepo()
    r.git('checkout', '-q', '--detach')
    const { diff } = await compute(r.dir)
    expect(diff.state).toBe('ok')
    expect(diff.compared).toMatchObject({ noDefault: true, onDefault: false, base: null })
  })

  it('uncommitted mode ignores a base and the default', async () => {
    const r = featureRepo()
    const { diff } = await compute(r.dir, { mode: 'uncommitted', base: 'main' })
    expect(diff.files).toEqual([])
    expect(diff.compared).toMatchObject({ mode: 'uncommitted', base: null })
  })

  it('an explicit base overrides the main-branch fallback', async () => {
    const r = featureRepo()
    r.git('checkout', '-q', 'main')
    r.git('checkout', '-q', '-b', 'other', 'feature')
    r.git('checkout', '-q', 'main')
    r.git('merge', '-q', '--ff-only', 'feature')
    const { diff } = await compute(r.dir, { base: 'other' })
    expect(diff.compared).toMatchObject({ base: 'other', onDefault: true })
  })
})

describe('computeDiff last commit view', () => {
  const lastCommit = (dir: string) => compute(dir, { mode: 'last-commit' })

  it('shows only the newest commit, without uncommitted or untracked files', async () => {
    const r = gitRepo()
    r.write('a.txt', 'one\n')
    r.commit()
    r.git('checkout', '-q', '-b', 'feature')
    r.write('b.txt', 'b\n')
    r.commit('first')
    r.write('c.txt', 'c\n')
    r.commit('second')
    r.write('a.txt', 'edited\n')
    r.write('new.txt', 'x\n')
    const { diff } = await lastCommit(r.dir)
    expect(diff.files.map((f) => f.path)).toEqual(['c.txt'])
    expect(diff.compared).toMatchObject({ mode: 'last-commit', base: null, noOwnCommits: false })
  })

  it('shows a root commit against the empty tree', async () => {
    const r = gitRepo()
    r.write('a.txt', 'one\n')
    r.commit()
    const { diff } = await lastCommit(r.dir)
    expect(diff.files.map((f) => f.path)).toEqual(['a.txt'])
    expect(diff.files[0]).toMatchObject({ status: 'added', additions: 1 })
  })

  it('shows main\'s latest commit when on main', async () => {
    const r = gitRepo()
    r.write('a.txt', 'one\n')
    r.commit()
    r.write('b.txt', 'b\n')
    r.commit()
    const { diff } = await lastCommit(r.dir)
    expect(diff.files.map((f) => f.path)).toEqual(['b.txt'])
    expect(diff.compared).toMatchObject({ onDefault: true, noOwnCommits: false })
  })

  it('shows no files when HEAD equals the merge-base with main', async () => {
    const r = gitRepo()
    r.write('a.txt', 'one\n')
    r.commit()
    r.write('b.txt', 'b\n')
    r.commit()
    r.git('checkout', '-q', '-b', 'feature')
    const { diff } = await lastCommit(r.dir)
    expect(diff.state).toBe('ok')
    expect(diff.files).toEqual([])
    expect(diff.compared.noOwnCommits).toBe(true)
  })

  it('shows no files in a repo without commits', async () => {
    const r = gitRepo()
    r.write('a.txt', 'one\n')
    const { diff } = await lastCommit(r.dir)
    expect(diff.state).toBe('ok')
    expect(diff.files).toEqual([])
  })

  it('changes the key when only the mode changes', async () => {
    const r = gitRepo()
    r.write('a.txt', 'one\n')
    r.commit()
    const keys = await Promise.all((['branch', 'uncommitted', 'last-commit'] as const).map(async (mode) => (await compute(r.dir, { mode })).key))
    expect(new Set(keys).size).toBe(3)
  })
})
