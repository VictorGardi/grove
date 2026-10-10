import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpoolClaude } from './claude/source'
import { claudeArgv } from './claude/hooks'
import { gitRunner } from './diff/git'
import { minimalEnv } from './env'
import { gitRepo } from './testing/gitRepo'
import { setupCore } from './testing/setup'
import { add as addWorktree, worktreePath } from './worktrees'

const created = (fake: { calls: { method: string; args: unknown[] }[] }) =>
  fake.calls.filter((c) => c.method === 'create').map((c) => c.args[0] as { cwd: string; argv?: string[] })

describe('sessionCreate for the CLI', () => {
  let t: ReturnType<typeof setupCore>
  beforeEach(() => { t = setupCore() })
  afterEach(() => t.disposeAll())

  async function start() {
    fs.mkdirSync(path.join(t.dir, 'docs', 'work', 'a'), { recursive: true })
    fs.writeFileSync(path.join(t.dir, 'docs', 'work', 'a', 'feature.md'), '---\nkind: feature\n---\n# a\n')
    fs.mkdirSync(path.join(t.dir, 'sub'))
    const core = t.make()
    await core.start()
    return core
  }
  const create = (core: Awaited<ReturnType<typeof start>>, a: Record<string, unknown>) =>
    core.commands.sessionCreate({ kind: 'terminal', cols: 120, rows: 40, ...a })

  it('carries the prompt per kind: opencode --prompt, claude --name then the text', async () => {
    const core = await start()
    await create(core, { cwd: t.dir, kind: 'opencode', prompt: 'say hi' })
    await create(core, { cwd: t.dir, kind: 'claude', prompt: 'say hi', label: 'helper' })
    const [oc, cl] = created(t.fake)
    expect(oc.argv![4]).toMatch(/^exec opencode -s ses_\S+ --prompt 'say hi'$/)
    expect(cl.argv![4]).toMatch(/^exec claude -s \S+ --name helper --prompt 'say hi'$/) // the fake source's argv
  })

  it('claude: name then prompt, and a prompt starting with - follows --', () => {
    const argv = claudeArgv('id', '/spool', 'start', undefined, { prompt: '-x', name: 'n' })
    expect(argv.slice(-4)).toEqual(['--name', 'n', '--', '-x'])
    expect(claudeArgv('id', '/spool', 'start', undefined, { prompt: 'hi' }).at(-1)).toBe('hi')
    expect(claudeArgv('id', '/spool', 'resume').includes('--name')).toBe(false)
  })

  it('real claude source: label becomes --name', async () => {
    const claudeDir = path.join(t.dir, 'agents', 'claude')
    const core = t.make(undefined, { sources: [t.oc, new SpoolClaude({ dir: claudeDir })] })
    await core.start()
    await create(core, { cwd: t.dir, kind: 'claude', prompt: 'p q', label: 'helper' })
    expect(created(t.fake)[0].argv![4]).toMatch(/--name helper 'p q'$/)
  })

  it('stores the folder for a subfolder, null for the project path, and starts the backend there', async () => {
    const core = await start()
    const sub = await create(core, { cwd: path.join(t.dir, 'sub') })
    const top = await create(core, { cwd: t.dir })
    if (!sub.ok || !top.ok) throw new Error('create failed')
    expect(sub.data.projectId).toBe('p')
    expect(sub.data.cwd).toBe(fs.realpathSync(path.join(t.dir, 'sub')))
    expect(top.data.cwd).toBeNull()
    expect(created(t.fake)[0].cwd).toBe(fs.realpathSync(path.join(t.dir, 'sub')))
    expect(created(t.fake)[1].cwd).toBe(t.dir)
  })

  it('refuses an unknown folder and creates nothing', async () => {
    const core = await start()
    expect(await create(core, { cwd: path.join(t.dir, 'missing') })).toEqual({ ok: false, error: 'not-found' })
    expect(created(t.fake)).toEqual([])
  })

  it("registers a new folder's git top level as a project", async () => {
    const core = await start()
    const repo = gitRepo()
    repo.commit()
    fs.mkdirSync(path.join(repo.dir, 'deep'))
    const res = await create(core, { cwd: path.join(repo.dir, 'deep') })
    if (!res.ok) throw new Error(res.error)
    const projects = core.getSlices().projects
    expect(projects).toHaveLength(2)
    expect(fs.realpathSync(projects[1].path)).toBe(fs.realpathSync(repo.dir))
    expect(res.data.projectId).toBe(projects[1].id)
    expect(res.data.cwd).toBe(fs.realpathSync(path.join(repo.dir, 'deep')))
  })

  // The tracer: a session in its own worktree becomes a project of its own, nested under the
  // repo's checkout, with the worktree root as its path — so every path-resolving subsystem
  // is right without a change (ADR 0037).
  it('registers a session\'s worktree as its own project, nested under the checkout', async () => {
    const core = await start()
    const repo = gitRepo()
    repo.write('README.md', 'hi\n')
    repo.commit()
    const checkout = await core.commands.projectAdd({ path: repo.dir })
    if (!checkout.ok) throw new Error(checkout.error)

    const wt = worktreePath(repo.dir, 'fix-auth', fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wt-')))
    const added = await addWorktree({ repo: repo.dir, branch: 'fix-auth', path: wt, git: gitRunner('git', minimalEnv(process.env)) })
    if (!added.ok) throw new Error(added.error)

    const res = await create(core, { cwd: wt })
    if (!res.ok) throw new Error(res.error)

    const projects = core.getSlices().projects
    const worktree = projects.find((p) => p.id === res.data.projectId)!
    expect(projects).toHaveLength(3)
    expect(fs.realpathSync(worktree.path)).toBe(fs.realpathSync(wt)) // project.path IS the worktree root
    expect(worktree.worktreeOf).toBe(checkout.data.id) // nested under the repo's checkout
    expect(res.data.cwd).toBeNull() // the session's folder is the project path, so nothing is stored
    expect(created(t.fake).at(-1)!.cwd).toBe(worktree.path) // and the pane starts in the worktree

    // config.json keeps schemaVersion 1 and carries the new field verbatim: it is additive
    // and optional, so there is no migration and no version bump (ADR 0037).
    const saved = JSON.parse(fs.readFileSync(t.configPath, 'utf8'))
    expect(saved.schemaVersion).toBe(1)
    expect(saved.projects.find((p: { id: string }) => p.id === worktree.id).worktreeOf).toBe(checkout.data.id)
    t.disposeAll()
    const again = t.make()
    await again.start()
    expect(again.getSlices().projects.find((p) => p.id === worktree.id)?.worktreeOf).toBe(checkout.data.id)
  })

  // The reason the worktree is a project: the diff of its session resolves against the
  // worktree, so it needs no fix — and the checkout the session is not in stays clean.
  it('diffs the worktree, not the checkout, and leaves the checkout clean', async () => {
    const core = await start()
    const repo = gitRepo()
    repo.write('README.md', 'hi\n')
    repo.commit()
    await core.commands.projectAdd({ path: repo.dir })
    const wt = worktreePath(repo.dir, 'fix-auth', fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wt-')))
    const added = await addWorktree({ repo: repo.dir, branch: 'fix-auth', path: wt, git: gitRunner('git', minimalEnv(process.env)) })
    if (!added.ok) throw new Error(added.error)
    const res = await create(core, { cwd: wt })
    if (!res.ok) throw new Error(res.error)

    fs.writeFileSync(path.join(wt, 'README.md'), 'changed\n')
    await core.commands.uiSet({ viewer: { kind: 'diff', sessionId: res.data.id } })
    await vi.waitFor(() => expect(core.getSlices().diff?.files).toHaveLength(1))
    expect(core.getSlices().diff).toMatchObject({ sessionId: res.data.id, state: 'ok', root: fs.realpathSync(wt) })
    expect(core.getSlices().diff!.files.map((f) => f.path)).toEqual(['README.md'])
    expect(execFileSync('git', ['-C', repo.dir, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('')
  })

  it('checks --link before creating: unknown → no-feature, nothing created or registered', async () => {
    const core = await start()
    expect(await create(core, { cwd: t.dir, feature: 'nope' })).toEqual({ ok: false, error: 'no-feature' })
    const other = fs.mkdtempSync(path.join(t.dir, '..', 'other-'))
    expect(await create(core, { cwd: other, feature: 'a' })).toEqual({ ok: false, error: 'no-feature' })
    expect(created(t.fake)).toEqual([])
    expect(core.getSlices().projects).toHaveLength(1)
  })

  it('pins a known link and a label', async () => {
    const core = await start()
    await vi.waitFor(() => expect(core.getSlices().features.items.some((f) => f.slug === 'a')).toBe(true))
    const res = await create(core, { cwd: t.dir, feature: 'a', label: 'mine' })
    expect(res).toMatchObject({ ok: true, data: { feature: 'a', linkPinned: true, label: 'mine', labelPinned: true } })
  })

  it('pastes the prompt into a terminal once the pane is stable', async () => {
    const core = await start()
    const res = await create(core, { cwd: t.dir, prompt: 'echo hi' })
    if (!res.ok) throw new Error(res.error)
    await vi.waitFor(() => expect(t.fake.pastes).toEqual([{ name: res.data.tmuxName, text: 'echo hi', submit: true }]), { timeout: 3000 })
  })

  it('resume starts a gone session in its stored folder', async () => {
    const core = await start()
    const res = await create(core, { cwd: path.join(t.dir, 'sub'), kind: 'opencode' })
    if (!res.ok) throw new Error(res.error)
    await core.commands.sessionKill({ id: res.data.id })
    await core.commands.sessionResume({ id: res.data.id })
    expect(created(t.fake).at(-1)!.cwd).toBe(fs.realpathSync(path.join(t.dir, 'sub')))
  })
})
