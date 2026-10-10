import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitRunner } from './diff/git'
import { gitCommonDir } from './git'
import { gitRepo } from './testing/gitRepo'
import { add, list, lock, merged, prune, remove, unlock, worktreePath } from './worktrees'

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

  it("reports git's own refusal for a directory that is not a worktree, and creates nothing", async () => {
    const repo = gitRepo()
    repo.commit()
    const at = worktreePath(repo.dir, 'fix-auth', home())
    fs.mkdirSync(at, { recursive: true }) // a plain directory: nothing to probe, so git decides
    fs.writeFileSync(path.join(at, 'mine.txt'), 'x')
    const res = await add({ repo: repo.dir, branch: 'fix-auth', path: at, git })
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toMatch(/already exists/i)
    expect(fs.readdirSync(at)).toEqual(['mine.txt'])
    expect(await list(repo.dir, git)).toHaveLength(1) // nothing was added
  })

  it('refuses without git', async () => {
    expect(await add({ repo: '/nope', branch: 'b', path: '/tmp/x', git: null })).toEqual({ ok: false, error: 'no-git' })
  })
})

// The design probes `git worktree list --porcelain` *before* `add`, so a conflict is our
// sentence rather than git's raw `fatal`.
describe('add refuses a conflict before git runs', () => {
  const created = async (repo: ReturnType<typeof gitRepo>, branch: string) => {
    const at = worktreePath(repo.dir, branch, home())
    const res = await add({ repo: repo.dir, branch, path: at, git })
    if (!res.ok) throw new Error(res.error)
    return at
  }

  it('names the worktree already holding the branch, and creates nothing', async () => {
    const repo = gitRepo()
    repo.commit()
    const first = await created(repo, 'fix-auth')
    const again = await add({ repo: repo.dir, branch: 'fix-auth', path: worktreePath(repo.dir, 'fix-auth', home()), git })
    expect(again.ok).toBe(false)
    expect(again.ok === false && again.error).toContain('fix-auth')
    expect(again.ok === false && again.error).toContain(fs.realpathSync(first)) // where it already is
    expect(await list(repo.dir, git)).toHaveLength(2) // the repo and the one worktree, unchanged
  })

  it('refuses a branch that already exists but is checked out nowhere', async () => {
    const repo = gitRepo()
    repo.commit()
    repo.git('branch', 'taken')
    const res = await add({ repo: repo.dir, branch: 'taken', path: worktreePath(repo.dir, 'taken', home()), git })
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toMatch(/taken/)
    expect(fs.existsSync(worktreePath(repo.dir, 'taken', home()))).toBe(false)
  })

  it('refuses the main checkout\'s own branch, naming the checkout', async () => {
    const repo = gitRepo()
    repo.commit()
    const res = await add({ repo: repo.dir, branch: 'main', path: worktreePath(repo.dir, 'main', home()), git })
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toContain('main')
    expect(await list(repo.dir, git)).toHaveLength(1)
  })

  it('refuses a path that is already a worktree of the repo, on any branch', async () => {
    const repo = gitRepo()
    repo.commit()
    const first = await created(repo, 'fix-auth')
    const res = await add({ repo: repo.dir, branch: 'other', path: first, git })
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toContain('fix-auth')
    expect(await list(repo.dir, git)).toHaveLength(2)
  })
})

describe('lock and unlock', () => {
  it('marks a worktree locked with a reason, and clears it again', async () => {
    const repo = gitRepo()
    repo.commit()
    const at = worktreePath(repo.dir, 'fix-auth', home())
    expect(await add({ repo: repo.dir, branch: 'fix-auth', path: at, git })).toMatchObject({ ok: true })

    expect(await lock(repo.dir, at, git, 'a grove session is running here')).toBe(true)
    expect(await list(repo.dir, git)).toMatchObject([{ branch: 'main', locked: false }, { branch: 'fix-auth', locked: true }])
    expect(out('-C', repo.dir, 'worktree', 'list', '--porcelain')).toContain('locked a grove session is running here')

    expect(await unlock(repo.dir, at, git)).toBe(true)
    expect(await list(repo.dir, git)).toMatchObject([{ branch: 'main' }, { branch: 'fix-auth', locked: false }])
  })

  it('keeps a locked worktree through prune even when its directory is gone, and lets go after unlock', async () => {
    const repo = gitRepo()
    repo.commit()
    const at = worktreePath(repo.dir, 'fix-auth', home())
    expect(await add({ repo: repo.dir, branch: 'fix-auth', path: at, git })).toMatchObject({ ok: true })
    expect(await lock(repo.dir, at, git)).toBe(true)

    fs.rmSync(at, { recursive: true, force: true })
    expect(await prune(repo.dir, git)).toBe(true)
    expect((await list(repo.dir, git)).map((w) => w.branch)).toEqual(['main', 'fix-auth']) // a live agent's checkout survives

    expect(await unlock(repo.dir, at, git)).toBe(true)
    expect(await prune(repo.dir, git)).toBe(true)
    expect((await list(repo.dir, git)).map((w) => w.branch)).toEqual(['main'])
  })

  it('reports false rather than throwing when git refuses', async () => {
    expect(await lock(worktreePath('/nope', 'x', home()), '/nope/x', git)).toBe(false)
    expect(await unlock('/nope', '/nope/x', git)).toBe(false)
    expect(await prune(home(), git)).toBe(false) // not a repo
  })
})

describe('remove', () => {
  it('deletes a clean worktree\'s directory and leaves the branch', async () => {
    const repo = gitRepo()
    repo.commit()
    const at = worktreePath(repo.dir, 'fix-auth', home())
    expect(await add({ repo: repo.dir, branch: 'fix-auth', path: at, git })).toMatchObject({ ok: true })

    expect(await remove(repo.dir, at, git)).toEqual({ ok: true, data: { path: at } })
    expect(fs.existsSync(at)).toBe(false)
    expect(out('-C', repo.dir, 'worktree', 'list', '--porcelain')).not.toContain('fix-auth')
    expect(out('-C', repo.dir, 'branch', '--list', 'fix-auth').trim()).toBe('fix-auth') // the work is kept
  })

  it('refuses a worktree with uncommitted work, and leaves it alone', async () => {
    const repo = gitRepo()
    repo.commit()
    const at = worktreePath(repo.dir, 'fix-auth', home())
    expect(await add({ repo: repo.dir, branch: 'fix-auth', path: at, git })).toMatchObject({ ok: true })
    fs.writeFileSync(path.join(at, 'wip.txt'), 'agent work\n')

    const res = await remove(repo.dir, at, git)
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toMatch(/uncommitted|modified/i)
    expect(fs.readFileSync(path.join(at, 'wip.txt'), 'utf8')).toBe('agent work\n')
  })

  it('refuses a locked worktree: a session is still running in it', async () => {
    const repo = gitRepo()
    repo.commit()
    const at = worktreePath(repo.dir, 'fix-auth', home())
    expect(await add({ repo: repo.dir, branch: 'fix-auth', path: at, git })).toMatchObject({ ok: true })
    expect(await lock(repo.dir, at, git)).toBe(true)

    const res = await remove(repo.dir, at, git)
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toMatch(/locked/i)
    expect(fs.existsSync(at)).toBe(true)
  })
})

describe('merged', () => {
  it('lists the worktrees whose branch is in the default branch, and only those', async () => {
    const repo = gitRepo()
    repo.commit()
    const done = worktreePath(repo.dir, 'done', home())
    expect(await add({ repo: repo.dir, branch: 'done', path: done, git })).toMatchObject({ ok: true })
    const wip = worktreePath(repo.dir, 'wip', home())
    expect(await add({ repo: repo.dir, branch: 'wip', path: wip, git })).toMatchObject({ ok: true })

    // a fresh worktree's branch is still main, so it is trivially merged: each needs real work
    // on it before "merged" means anything
    out('-C', done, 'commit', '-q', '--allow-empty', '-m', 'the work')
    out('-C', wip, 'commit', '-q', '--allow-empty', '-m', 'more work') // unmerged
    expect(await merged(repo.dir, git)).toEqual([])

    out('-C', repo.dir, 'merge', '-q', '--ff-only', 'done')

    const all = await merged(repo.dir, git)
    expect(all.map((w) => w.branch)).toEqual(['done']) // never the checkout itself
    expect(fs.realpathSync(all[0].path)).toBe(fs.realpathSync(done))
  })

  it('is empty for a repo with no default branch', async () => {
    const repo = gitRepo()
    repo.git('checkout', '-q', '--orphan', 'topic')
    repo.git('commit', '-q', '--allow-empty', '-m', 'orphan')
    const at = worktreePath(repo.dir, 'other', home())
    expect(await add({ repo: repo.dir, branch: 'other', path: at, git })).toMatchObject({ ok: true })
    expect(await merged(repo.dir, git)).toEqual([])
  })

  // Asked from inside a worktree — which is what grove does when the repo's checkout is not a
  // registered project — the answer must still exclude the checkout and include the worktrees.
  it('works when repo is spelled as one of the worktrees', async () => {
    const repo = gitRepo()
    repo.commit()
    const done = worktreePath(repo.dir, 'done', home())
    expect(await add({ repo: repo.dir, branch: 'done', path: done, git })).toMatchObject({ ok: true })
    const other = worktreePath(repo.dir, 'other', home())
    expect(await add({ repo: repo.dir, branch: 'other', path: other, git })).toMatchObject({ ok: true })
    out('-C', done, 'commit', '-q', '--allow-empty', '-m', 'the work')
    out('-C', other, 'commit', '-q', '--allow-empty', '-m', 'unmerged work')
    out('-C', repo.dir, 'merge', '-q', '--ff-only', 'done')

    const all = await merged(other, git) // asked from an unrelated worktree, not the checkout
    expect(all.map((w) => w.branch)).toEqual(['done'])
    expect(fs.realpathSync(all[0].path)).toBe(fs.realpathSync(done))
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