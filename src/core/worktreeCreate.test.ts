import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { worktreePathIn } from './worktrees'
import type { Core } from './core'
import { gitRepo } from './testing/gitRepo'
import { setupCore } from './testing/setup'

// `worktreeCreate` is the app's half of what the CLI does with --worktree --branch (ADR 0037):
// make the checkout, register it as a project nested under its checkout, and hand back the id a
// session can be created in. It is a separate command from `sessionCreate` so that a conflict is
// reported against the form the human is still looking at, rather than failing a session that was
// never created.
describe('worktreeCreate', () => {
  let t: ReturnType<typeof setupCore>
  let core: ReturnType<typeof setupCore>['make'] extends () => infer R ? R : never
  let repo: ReturnType<typeof gitRepo>
  let checkoutId: string
  let root: string

  // One core per test, on the shared files: setupCore's config is written once, so starting a
  // second core would reload this one's project and the project ids in the assertions drift.
  beforeEach(async () => {
    t = setupCore()
    // the worktree root is injected, so a test never writes into the real ~/.grove
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wtroot-'))
    repo = gitRepo()
    repo.write('README.md', 'hi\n')
    repo.commit()
    core = t.make(undefined, { worktreeRoot: root })
    await core.start()
    const added = await core.commands.projectAdd({ path: repo.dir })
    if (!added.ok) throw new Error(added.error)
    checkoutId = added.data.id
  })

  afterEach(() => {
    t.disposeAll()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('makes the checkout and registers it as a project nested under the checkout', async () => {
    const res = await core.commands.worktreeCreate({ projectId: checkoutId, branch: 'fix-auth' })
    if (!res.ok) throw new Error(res.error)

    expect(res.data.worktreeOf).toBe(checkoutId)
    expect(res.data.name).toBe(`${path.basename(repo.dir)} · fix-auth`) // a flat list of checkouts reads as unrelated repos
    expect(fs.realpathSync(res.data.path)).toBe(fs.realpathSync(worktreePathIn(root, repo.dir, 'fix-auth')))
    expect(fs.existsSync(path.join(res.data.path, 'README.md'))).toBe(true)
    expect(core.getSlices().projects.some((p) => p.id === res.data.id)).toBe(true)
  })

  it('removes the checkout and its project, and refuses the main checkout', async () => {
    const res = await core.commands.worktreeCreate({ projectId: checkoutId, branch: 'fix-auth' })
    if (!res.ok) throw new Error(res.error)
    expect(await core.commands.worktreeRemove({ projectId: checkoutId })).toEqual({ ok: false, error: 'not-found' })
    expect(await core.commands.worktreeRemove({ projectId: res.data.id })).toEqual({ ok: true, data: { id: res.data.id } })
    expect(fs.existsSync(res.data.path)).toBe(false)
    expect(core.getSlices().projects.some((p) => p.id === res.data.id)).toBe(false)
  })

  it('keeps a worktree with uncommitted work, for git refuses to remove it', async () => {
    const res = await core.commands.worktreeCreate({ projectId: checkoutId, branch: 'fix-auth' })
    if (!res.ok) throw new Error(res.error)
    fs.writeFileSync(path.join(res.data.path, 'wip.txt'), 'x')
    fs.appendFileSync(path.join(res.data.path, 'README.md'), 'edit\n')
    expect((await core.commands.worktreeRemove({ projectId: res.data.id })).ok).toBe(false)
    expect(core.getSlices().projects.some((p) => p.id === res.data.id)).toBe(true)
  })

  it('puts the checkout under the injected root, not the real home', async () => {
    const res = await core.commands.worktreeCreate({ projectId: checkoutId, branch: 'fix-auth' })
    if (!res.ok) throw new Error(res.error)
    // realpath on both sides: macOS puts the temp dir behind a symlink, and the project records
    // the resolved path
    expect(fs.realpathSync(res.data.path).startsWith(fs.realpathSync(root) + path.sep)).toBe(true)
    expect(res.data.path).not.toContain(path.join(os.homedir(), '.grove'))
  })

  // With no root configured the command uses the layout it always had, so an existing checkout
  // is never orphaned by the upgrade. `worktreeRoot` is an override, not a relocation.
  // HOME is pointed at the temp root for this one: it is the only test that exercises the real
  // default, and a test has no business writing into the developer's ~/.grove.
  it('uses the default layout when no root is configured', async () => {
    const real = os.homedir()
    t.disposeAll()
    fs.rmSync(t.configPath)
    vi.stubEnv('HOME', root)
    try {
      const plain = t.make()
      await plain.start()
      const added = await plain.commands.projectAdd({ path: repo.dir })
      if (!added.ok) throw new Error(added.error)
      const res = await plain.commands.worktreeCreate({ projectId: added.data.id, branch: 'fix-auth' })
      if (!res.ok) throw new Error(res.error)
      // realpath on both sides: macOS puts the temp dir behind a symlink, and the project
      // records the resolved path
      expect(fs.realpathSync(res.data.path)).toBe(
        fs.realpathSync(path.join(root, '.grove', 'worktrees', path.basename(repo.dir), 'fix-auth')),
      )
      expect(res.data.path).not.toContain(real) // and never the real home
    } finally {
      vi.unstubAllEnvs()
      fs.rmSync(path.join(root, '.grove'), { recursive: true, force: true })
    }
  })

  // A session can be created in it exactly as in any other checkout: the worktree is a project,
  // so the pane starts there and the diff resolves against it (ADR 0037).
  it('is a project a session can then be created in', async () => {
    const wt = await core.commands.worktreeCreate({ projectId: checkoutId, branch: 'fix-auth' })
    if (!wt.ok) throw new Error(wt.error)
    const res = await core.commands.sessionCreate({ projectId: wt.data.id, kind: 'claude', cols: 120, rows: 40 })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.projectId).toBe(wt.data.id)
    expect(fs.realpathSync(res.data.cwd ?? wt.data.path)).toBe(fs.realpathSync(wt.data.path))
  })

  // A worktree of a worktree still forks the checkout, never the sibling worktree's branch.
  it('forks the parent checkout when asked from a worktree', async () => {
    const first = await core.commands.worktreeCreate({ projectId: checkoutId, branch: 'fix-auth' })
    if (!first.ok) throw new Error(first.error)
    const second = await core.commands.worktreeCreate({ projectId: first.data.id, branch: 'fix-grid' })
    if (!second.ok) throw new Error(second.error)
    expect(second.data.worktreeOf).toBe(checkoutId)
    expect(second.data.id).not.toBe(first.data.id)
  })

  it('names the conflict in our own words rather than passing git\'s fatal', async () => {
    expect((await core.commands.worktreeCreate({ projectId: checkoutId, branch: 'fix-auth' })).ok).toBe(true)
    const again = await core.commands.worktreeCreate({ projectId: checkoutId, branch: 'fix-auth' })
    expect(again.ok).toBe(false)
    if (again.ok) return
    expect(again.error).toContain('fix-auth')
    expect(again.error).not.toContain('fatal') // our sentence, not git's
  })

  it('refuses nothing to create, and refuses a project that is not there', async () => {
    expect(await core.commands.worktreeCreate({ projectId: checkoutId, branch: '   ' })).toEqual({ ok: false, error: 'no-branch' })
    expect(await core.commands.worktreeCreate({ projectId: 'nope', branch: 'fix-auth' })).toEqual({ ok: false, error: 'not-found' })
  })

  // Nothing is registered when the checkout cannot be made, so a failure leaves no project
  // pointing at a directory that does not exist.
  it('registers nothing when the checkout cannot be made', async () => {
    // setupCore's config.json already carries a project, so a second core would reload it and the
    // id in the assertion would be wrong. Started on a cleared config instead.
    t.disposeAll()
    fs.rmSync(t.configPath)
    const blind = t.make(undefined, { worktreeRoot: root, git: null })
    await blind.start()
    const added = await blind.commands.projectAdd({ path: repo.dir })
    if (!added.ok) throw new Error(added.error)
    expect(await blind.commands.worktreeCreate({ projectId: added.data.id, branch: 'fix-auth' })).toEqual({ ok: false, error: 'no-repo' })
    expect(blind.getSlices().projects.map((p) => p.id)).toEqual([added.data.id])
  })

  // A project can be any folder, so "not a repository" is the answer rather than git's `fatal` —
  // the dialog offers a worktree for every group, and a plain folder is in one of them.
  it('says no-repo for a folder that is not a repository, before asking git to fail', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-notrepo-'))
    try {
      const added = await core.commands.projectAdd({ path: plain })
      if (!added.ok) throw new Error(added.error)
      expect(await core.commands.worktreeCreate({ projectId: added.data.id, branch: 'fix-auth' })).toEqual({ ok: false, error: 'no-repo' })
    } finally {
      fs.rmSync(plain, { recursive: true, force: true })
    }
  })
})

// What the launch picker shows on each row: a checkout's current branch, and the default a new
// worktree would branch from. `readBranch` needs no process; the default needs origin/HEAD.
describe('repoRefs', () => {
  let t: ReturnType<typeof setupCore>
  let core: Core
  let repo: ReturnType<typeof gitRepo>
  let checkoutId: string
  let root: string

  beforeEach(async () => {
    t = setupCore()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-refs-wt-'))
    repo = gitRepo()
    repo.write('README.md', 'hi\n')
    repo.commit()
    core = t.make(undefined, { worktreeRoot: root })
    await core.start()
    const added = await core.commands.projectAdd({ path: repo.dir })
    if (!added.ok) throw new Error(added.error)
    checkoutId = added.data.id
  })

  afterEach(() => {
    t.disposeAll()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('names the branch the checkout is on and the default one', async () => {
    const res = await core.commands.repoRefs({ projectId: checkoutId })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.branch).toBe('main') // gitRepo() initialises -b main
    expect(res.data.default).toBe('main')
  })

  it('follows the checkout to a branch it switched to', async () => {
    repo.git('checkout', '-q', '-b', 'feature')
    const res = await core.commands.repoRefs({ projectId: checkoutId })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.branch).toBe('feature')
    expect(res.data.default).toBe('main') // the default does not move with the checkout
  })

  // A worktree's own HEAD, not its parent's: the row says what that checkout is on.
  it('reports a worktree as the branch it checked out', async () => {
    const made = await core.commands.worktreeCreate({ projectId: checkoutId, branch: 'fix-auth' })
    if (!made.ok) throw new Error(made.error)
    const wt = await core.commands.repoRefs({ projectId: made.data.id })
    if (!wt.ok) throw new Error(wt.error)
    expect(wt.data.branch).toBe('fix-auth')
  })

  it('reports nulls for a folder that is not a repository, rather than failing', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-notrepo-'))
    try {
      const added = await core.commands.projectAdd({ path: plain })
      if (!added.ok) throw new Error(added.error)
      expect(await core.commands.repoRefs({ projectId: added.data.id })).toEqual({ ok: true, data: { branch: null, default: null } })
    } finally {
      fs.rmSync(plain, { recursive: true, force: true })
    }
  })

  it('refuses an id no project has', async () => {
    expect(await core.commands.repoRefs({ projectId: 'nope' })).toEqual({ ok: false, error: 'not-found' })
  })
})