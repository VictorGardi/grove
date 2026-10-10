import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Core } from './core'
import { gitRunner } from './diff/git'
import { minimalEnv } from './env'
import { loadConfig, saveConfig } from './store/configStore'
import { gitRepo } from './testing/gitRepo'
import { setupCore } from './testing/setup'
import { add, lock, worktreePath } from './worktrees'

const git = gitRunner('git', minimalEnv(process.env))
const out = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' })

// git spells a worktree's path its own way, so compare the way it printed it.
const lockedAt = (repo: string, at: string): boolean =>
  out('-C', repo, 'worktree', 'list', '--porcelain')
    .split('\n\n')
    .some((b) => b.startsWith(`worktree ${fs.realpathSync(at)}\n`) && b.includes('\nlocked'))

// A worktree is locked while a session runs on it, so `git worktree prune` or `gc` cannot take
// the checkout away under a live agent (design: Lifecycle).
describe('locking a worktree for as long as a session runs in it', () => {
  let t: ReturnType<typeof setupCore>
  beforeEach(() => { t = setupCore() })
  afterEach(() => t.disposeAll())

  // A real repo, its checkout registered as a project, one worktree on `branch`, one session in it.
  async function worktreeSession(branch = 'fix-auth') {
    const repo = gitRepo()
    repo.write('README.md', 'hi\n')
    repo.commit()
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wt-'))
    const core = t.make()
    await core.start()
    const checkout = await core.commands.projectAdd({ path: repo.dir })
    if (!checkout.ok) throw new Error(checkout.error)
    const at = worktreePath(repo.dir, branch, home)
    if (!(await add({ repo: repo.dir, branch, path: at, git })).ok) throw new Error('add failed')
    const res = await core.commands.sessionCreate({ cwd: at, kind: 'terminal', cols: 80, rows: 24 })
    if (!res.ok) throw new Error(res.error)
    return { core, repo, at, checkout, session: res.data, projectId: res.data.projectId }
  }

  it('locks the worktree a session was created in', async () => {
    const { repo, at } = await worktreeSession()
    expect(lockedAt(repo.dir, at)).toBe(true)
  })

  it('never locks a plain checkout', async () => {
    const repo = gitRepo()
    repo.commit()
    const core = t.make()
    await core.start()
    const checkout = await core.commands.projectAdd({ path: repo.dir })
    if (!checkout.ok) throw new Error(checkout.error)
    const res = await core.commands.sessionCreate({ projectId: checkout.data.id, kind: 'terminal', cols: 80, rows: 24 })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.projectId).toBe(checkout.data.id)
    expect(lockedAt(repo.dir, repo.dir)).toBe(false)
  })

  it('unlocks on kill, once no live session is left on the worktree', async () => {
    const { core, repo, at, session, projectId } = await worktreeSession()
    const second = await core.commands.sessionCreate({ projectId, kind: 'terminal', cols: 80, rows: 24 })
    if (!second.ok) throw new Error(second.error)

    await core.commands.sessionKill({ id: second.data.id })
    expect(lockedAt(repo.dir, at)).toBe(true) // the first session is still running

    await core.commands.sessionKill({ id: session.id })
    expect(core.getSlices().sessions.every((s) => s.projectId !== projectId || s.lastStatus === 'gone')).toBe(true)
    expect(lockedAt(repo.dir, at)).toBe(false)
  })

  it('unlocks on remove — ⌘W — with the session gone', async () => {
    const { core, repo, at, session } = await worktreeSession()
    expect(await core.commands.sessionRemove({ id: session.id })).toMatchObject({ ok: true })
    expect(lockedAt(repo.dir, at)).toBe(false)
  })

  it('leaves an unlocked worktree alone when git is missing', async () => {
    const repo = gitRepo()
    repo.commit()
    const core = t.make(undefined, { git: null })
    await core.start()
    const checkout = await core.commands.projectAdd({ path: repo.dir })
    if (!checkout.ok) throw new Error(checkout.error)
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wt-'))
    const at = worktreePath(repo.dir, 'probe', home)
    expect(await add({ repo: repo.dir, branch: 'probe', path: at, git })).toMatchObject({ ok: true })
    const res = await core.commands.sessionCreate({ cwd: at, kind: 'terminal', cols: 80, rows: 24 })
    if (!res.ok) throw new Error(res.error)
    expect(core.getSlices().projects.some((p) => p.worktreeOf === checkout.data.id)).toBe(true)
    expect(lockedAt(repo.dir, at)).toBe(false) // no runner, no lock — and no failure either
  })
})

// A worktree project whose directory is gone cannot be classified by git, so it would sit in the
// sidebar ungrouped for good (design: Risks).
describe('pruning a dead worktree project at start', () => {
  let t: ReturnType<typeof setupCore>
  beforeEach(() => { t = setupCore() })
  afterEach(() => t.disposeAll())

  it('drops the row, prunes git with it, and keeps a plain project whose folder is gone', async () => {
    const repo = gitRepo()
    repo.write('README.md', 'hi\n')
    repo.commit()
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wt-'))
    const dead = worktreePath(repo.dir, 'gone', home)
    if (!(await add({ repo: repo.dir, branch: 'gone', path: dead, git })).ok) throw new Error('add failed')
    saveConfig(t.configPath, {
      schemaVersion: 1,
      projects: [
        { id: 'repo', name: 'repo', path: repo.dir },
        { id: 'wt', name: 'repo · gone', path: dead, worktreeOf: 'repo' },
        { id: 'plain', name: 'plain', path: path.join(t.dir, 'never-existed') },
      ],
    })
    fs.rmSync(dead, { recursive: true, force: true })

    const core = t.make()
    await core.start()

    expect(core.getSlices().projects.map((p) => p.id)).toEqual(['repo', 'plain']) // only worktrees are pruned
    expect(loadConfig(t.configPath).projects.map((p) => p.id)).toEqual(['repo', 'plain'])
    expect(out('-C', repo.dir, 'worktree', 'list', '--porcelain')).not.toContain('gone')
    expect(core.getErrors()).toEqual([])
  })

  // A live session's worktree is locked, and git refuses to prune a locked one — so a worktree
  // deleted out from under a running session leaves a ghost only unlock can clear.
  it('unlocks a worktree whose session was live when its directory went, then prunes it', async () => {
    const repo = gitRepo()
    repo.write('README.md', 'hi\n')
    repo.commit()
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wt-'))
    const at = worktreePath(repo.dir, 'doomed', home)
    expect(await add({ repo: repo.dir, branch: 'doomed', path: at, git })).toMatchObject({ ok: true })
    saveConfig(t.configPath, {
      schemaVersion: 1,
      projects: [
        { id: 'repo', name: 'repo', path: repo.dir },
        { id: 'wt', name: 'repo · doomed', path: at, worktreeOf: 'repo' },
      ],
    })
    // a session was live in it, so grove had locked it
    expect(await lock(repo.dir, at, git, 'a grove session is running here')).toBe(true)

    fs.rmSync(at, { recursive: true, force: true })
    const core = t.make()
    await core.start()

    expect(core.getSlices().projects.map((p) => p.id)).toEqual(['repo'])
    expect(out('-C', repo.dir, 'worktree', 'list', '--porcelain')).not.toContain('doomed') // not a ghost
    // and prune alone would not have been enough
    expect(out('-C', repo.dir, 'worktree', 'list', '--porcelain').includes('locked')).toBe(false)
  })

  it('keeps a worktree project whose directory is still there', async () => {
    const repo = gitRepo()
    repo.commit()
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wt-'))
    const alive = worktreePath(repo.dir, 'alive', home)
    if (!(await add({ repo: repo.dir, branch: 'alive', path: alive, git })).ok) throw new Error('add failed')
    saveConfig(t.configPath, {
      schemaVersion: 1,
      projects: [
        { id: 'repo', name: 'repo', path: repo.dir },
        { id: 'wt', name: 'repo · alive', path: alive, worktreeOf: 'repo' },
      ],
    })

    const core = t.make()
    await core.start()
    expect(core.getSlices().projects.map((p) => p.id)).toEqual(['repo', 'wt'])
    expect(loadConfig(t.configPath).projects).toHaveLength(2)
  })
})

// "Clean up merged" (Q3): a merged worktree nobody is working in can go.
describe('cleanupMergedWorktrees', () => {
  let t: ReturnType<typeof setupCore>
  beforeEach(() => { t = setupCore() })
  afterEach(() => t.disposeAll())

  // A real repo whose checkout is registered, with one worktree per branch, each a project.
  // Every worktree starts with a commit of its own, so none of them is trivially merged.
  async function withWorktrees(...branches: string[]) {
    const repo = gitRepo()
    repo.write('README.md', 'hi\n')
    repo.commit()
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wt-'))
    const core: Core = t.make()
    await core.start()
    if (!(await core.commands.projectAdd({ path: repo.dir })).ok) throw new Error('projectAdd failed')
    const at = new Map<string, string>()
    for (const b of branches) {
      const p = worktreePath(repo.dir, b, home)
      if (!(await add({ repo: repo.dir, branch: b, path: p, git })).ok) throw new Error('add failed')
      out('-C', p, 'commit', '-q', '--allow-empty', '-m', `work on ${b}`)
      at.set(b, p)
      if (!(await core.commands.projectAdd({ path: p })).ok) throw new Error('projectAdd failed')
    }
    const merge = (b: string) => out('-C', repo.dir, 'merge', '-q', '--ff-only', b)
    return { core, repo, at, merge }
  }
  // Only the worktree projects, by checkout name: the seeded project and the repo are noise here.
  const worktreesOf = (core: Core) =>
    core.getSlices().projects.filter((p) => p.worktreeOf).map((p) => path.basename(p.path))

  it('removes a merged worktree nobody is working in, and leaves the unmerged one', async () => {
    const { core, repo, at, merge } = await withWorktrees('done', 'wip')
    merge('done')

    const res = await core.cleanupMergedWorktrees()
    expect(res).toEqual({ ok: true, data: { removed: [at.get('done')!], failed: [] } })
    expect(fs.existsSync(at.get('done')!)).toBe(false)
    expect(out('-C', repo.dir, 'branch', '--list', 'done').trim()).toBe('done') // the work is kept
    expect(worktreesOf(core)).toEqual(['wip'])
    expect(loadConfig(t.configPath).projects).toHaveLength(3) // seeded, checkout, wip
  })

  it('keeps a merged worktree that still has a running session', async () => {
    const { core, repo, at, merge } = await withWorktrees('done')
    merge('done')
    const res = await core.commands.sessionCreate({ cwd: at.get('done')!, kind: 'terminal', cols: 80, rows: 24 })
    if (!res.ok) throw new Error(res.error)
    expect(lockedAt(repo.dir, at.get('done')!)).toBe(true) // and locked, so nothing else can take it

    expect(await core.cleanupMergedWorktrees()).toMatchObject({ ok: true, data: { removed: [] } })
    expect(fs.existsSync(at.get('done')!)).toBe(true)
    expect(worktreesOf(core)).toEqual(['done'])
  })

  it('reports git\'s refusal for a worktree with uncommitted work, and leaves it', async () => {
    const { core, at, merge } = await withWorktrees('done')
    merge('done')
    fs.writeFileSync(path.join(at.get('done')!, 'wip.txt'), 'not committed\n')

    const res = await core.cleanupMergedWorktrees()
    expect(res.ok).toBe(true)
    expect(res.ok === true && res.data.removed).toEqual([])
    expect(res.ok === true && res.data.failed.map((f) => f.error).join(' ')).toMatch(/uncommitted|modified/i)
    expect(worktreesOf(core)).toEqual(['done'])
  })

  it('does nothing when git is missing', async () => {
    const core = t.make(undefined, { git: null })
    await core.start()
    expect(await core.cleanupMergedWorktrees()).toEqual({ ok: false, error: 'no-git' })
  })

  // The checkout can be gone as a project — removed, or never registered — while the worktree
  // lives on. Cleanup must still find the repo and reclaim it.
  it('cleans up a worktree whose checkout is no longer a registered project', async () => {
    const repo = gitRepo()
    repo.write('README.md', 'hi\n')
    repo.commit()
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wt-'))
    const at = worktreePath(repo.dir, 'done', home)
    expect(await add({ repo: repo.dir, branch: 'done', path: at, git })).toMatchObject({ ok: true })
    out('-C', at, 'commit', '-q', '--allow-empty', '-m', 'the work')
    out('-C', repo.dir, 'merge', '-q', '--ff-only', 'done')
    saveConfig(t.configPath, {
      schemaVersion: 1,
      projects: [{ id: 'wt', name: 'repo · done', path: at, worktreeOf: 'a-checkout-that-is-not-a-project' }],
    })

    const core = t.make()
    await core.start()
    expect(await core.cleanupMergedWorktrees()).toEqual({ ok: true, data: { removed: [at], failed: [] } })
    expect(fs.existsSync(at)).toBe(false)
    expect(worktreesOf(core)).toEqual([])
  })
})