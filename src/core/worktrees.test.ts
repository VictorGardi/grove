import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitRunner } from './diff/git'
import { gitCommonDir } from './git'
import { gitRepo } from './testing/gitRepo'
import { add, list, worktreePath } from './worktrees'

// `protocol.file.allow` is what lets git clone a submodule from a path on this machine; the
// submodule test needs it, and grove itself never turns it on.
const git = gitRunner('git', {
  ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C',
  GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'protocol.file.allow', GIT_CONFIG_VALUE_0: 'always',
})
const out = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' })
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wt-'))

describe('worktreePath', () => {
  it('is ~/.grove/worktrees/<repo>/<branch>, with the branch as one path segment', () => {
    expect(worktreePath('/src/grove', 'fix-auth', '/home/me')).toBe('/home/me/.grove/worktrees/grove/fix-auth')
    expect(worktreePath('/src/grove', 'feat/auth/login', '/home/me')).toBe('/home/me/.grove/worktrees/grove/feat-auth-login')
    expect(worktreePath('/src/grove', 'a..b~c', '/home/me')).toBe('/home/me/.grove/worktrees/grove/a..b-c')
  })

  it('defaults to the real home directory', () => {
    expect(worktreePath('/src/grove', 'x')).toBe(path.join(os.homedir(), '.grove', 'worktrees', 'grove', 'x'))
  })
})

describe('add', () => {
  it('creates a checkout of the repo on the new branch, at the path', async () => {
    const repo = gitRepo()
    repo.write('README.md', 'hi\n')
    repo.commit()
    const at = worktreePath(repo.dir, 'fix-auth', home())
    const res = await add({ repo: repo.dir, branch: 'fix-auth', path: at, git })
    if (!res.ok) throw new Error(res.error)
    expect(res.data).toEqual({ path: at, branch: 'fix-auth' })
    expect(out('-C', at, 'rev-parse', '--show-toplevel').trim()).toBe(fs.realpathSync(at))
    expect(out('-C', at, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('fix-auth')
    expect(gitCommonDir(at)).toBe(gitCommonDir(repo.dir)) // one repo, one object store
    expect(fs.readFileSync(path.join(at, 'README.md'), 'utf8')).toBe('hi\n') // the committed tree, checked out
  })

  it('leaves the main checkout clean and on its own branch', async () => {
    const repo = gitRepo()
    repo.write('README.md', 'hi\n')
    repo.commit()
    const at = worktreePath(repo.dir, 'probe', home())
    expect(await add({ repo: repo.dir, branch: 'probe', path: at, git })).toMatchObject({ ok: true })
    expect(out('-C', repo.dir, 'status', '--porcelain')).toBe('')
    expect(out('-C', repo.dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main')
  })

  it('initialises submodules in the new worktree', async () => {
    const sub = gitRepo()
    sub.write('lib.txt', 'from sub\n')
    sub.commit()
    const repo = gitRepo()
    repo.git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub.dir, 'lib')
    repo.commit()
    const at = worktreePath(repo.dir, 'with-sub', home())
    expect(await add({ repo: repo.dir, branch: 'with-sub', path: at, git })).toMatchObject({ ok: true })
    expect(fs.readFileSync(path.join(at, 'lib', 'lib.txt'), 'utf8')).toBe('from sub\n')
    expect(fs.existsSync(path.join(at, 'lib', '.git'))).toBe(true)
  })

  it("reports git's own refusal and creates nothing", async () => {
    const repo = gitRepo()
    repo.commit()
    const at = worktreePath(repo.dir, 'main', home())
    fs.mkdirSync(at, { recursive: true }) // git refuses an existing path
    const res = await add({ repo: repo.dir, branch: 'main', path: at, git })
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toMatch(/already exists/i)
    expect(fs.readdirSync(at)).toEqual([])
    expect(await list(repo.dir, git)).toHaveLength(1) // nothing was added
  })

  it('refuses without git', async () => {
    expect(await add({ repo: '/nope', branch: 'b', path: '/tmp/x', git: null })).toEqual({ ok: false, error: 'no-git' })
  })
})

describe('list', () => {
  it('reads every worktree of the repo, the main checkout first, with branches and locks', async () => {
    const repo = gitRepo()
    repo.commit()
    const at = worktreePath(repo.dir, 'fix-auth', home())
    expect(await add({ repo: repo.dir, branch: 'fix-auth', path: at, git })).toMatchObject({ ok: true })
    out('-C', repo.dir, 'worktree', 'lock', at)

    const all = await list(repo.dir, git)
    expect(all).toHaveLength(2)
    expect(all[0]).toMatchObject({ branch: 'main', locked: false })
    expect(fs.realpathSync(all[0].path)).toBe(fs.realpathSync(repo.dir))
    expect(all[1]).toMatchObject({ branch: 'fix-auth', locked: true }) // git spells the path its own way
    expect(fs.realpathSync(all[1].path)).toBe(fs.realpathSync(at))
    expect(all[0].head).toMatch(/^[0-9a-f]{40}$/)
  })

  it('is empty for no repo at all', async () => {
    expect(await list(home(), git)).toEqual([])
  })
})