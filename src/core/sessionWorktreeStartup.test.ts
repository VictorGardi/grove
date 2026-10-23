import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as worktrees from './worktrees'
import { gitRepo } from './testing/gitRepo'
import { setupCore } from './testing/setup'

// `session:create` with `worktree`: the card is in at once under the source project, and moves to
// the worktree's project (same id) once git has made it.
describe('session start in a new worktree', () => {
  let t: ReturnType<typeof setupCore>
  let root: string
  let repo: ReturnType<typeof gitRepo>

  beforeEach(() => {
    t = setupCore()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wtroot-'))
    repo = gitRepo()
    repo.write('README.md', 'hi\n')
    repo.commit()
  })
  afterEach(() => {
    t.disposeAll()
    fs.rmSync(root, { recursive: true, force: true })
  })

  async function setup(hold: boolean) {
    let release!: () => void
    const gate = new Promise<void>((res) => { release = res })
    const core = t.make(undefined, {
      worktreeRoot: root,
      worktreeAdd: async (o) => {
        if (hold) await gate
        return worktrees.add(o)
      },
    })
    await core.start()
    const added = await core.commands.projectAdd({ path: repo.dir })
    if (!added.ok) throw new Error(added.error)
    return { core, release, source: added.data.id }
  }

  it('shows the card under the source project while the worktree is made, then re-homes it with the same id', async () => {
    const { core, release, source } = await setup(true)
    const created = core.commands.sessionCreate({ projectId: source, worktree: { branch: 'feat' }, kind: 'terminal', cols: 80, rows: 24 })
    await new Promise((r) => setTimeout(r, 20))
    const early = core.getSlices().sessions
    expect(early).toHaveLength(1)
    expect(early[0].projectId).toBe(source)
    expect(early[0].startup?.phase).toBe('starting')
    const id = early[0].id
    release()
    const res = await created
    if (!res.ok) throw new Error(res.error)
    expect(res.data.id).toBe(id)
    const wt = core.getSlices().projects.find((p) => p.worktreeOf === source)
    expect(wt).toBeDefined()
    expect(core.getSlices().sessions).toHaveLength(1)
    expect(core.getSlices().sessions[0].projectId).toBe(wt!.id)
    expect(res.data.projectId).toBe(wt!.id)
  })

  it('leaves a failed card, returns the error and makes no project when the worktree fails', async () => {
    const { core, release, source } = await setup(false)
    release()
    const res = await core.commands.sessionCreate({ projectId: source, worktree: { branch: 'feat', base: 'ghost' }, kind: 'terminal', cols: 80, rows: 24 })
    expect(res.ok).toBe(false)
    const s = core.getSlices().sessions
    expect(s).toHaveLength(1)
    expect(s[0].projectId).toBe(source)
    expect(s[0].startup?.phase).toBe('failed')
    expect(core.getSlices().projects.some((p) => p.worktreeOf === source)).toBe(false)
    const dismissed = await core.commands.sessionDismissStartup({ id: s[0].id })
    expect(dismissed.ok).toBe(true)
    expect(core.getSlices().sessions).toHaveLength(0)
  })

  it('keeps the worktree and its project, and fails only the card, when the pane cannot be made', async () => {
    const { core, source } = await setup(false)
    t.fake.create = async () => { throw new Error('tmux down') }
    await expect(core.commands.sessionCreate({ projectId: source, worktree: { branch: 'feat' }, kind: 'terminal', cols: 80, rows: 24 })).rejects.toThrow('tmux down')
    const wt = core.getSlices().projects.find((p) => p.worktreeOf === source)
    expect(wt).toBeDefined()
    expect(fs.existsSync(wt!.path)).toBe(true)
    const s = core.getSlices().sessions
    expect(s).toHaveLength(1)
    expect(s[0].projectId).toBe(wt!.id)
    expect(s[0].startup).toMatchObject({ phase: 'failed', reason: 'tmux down' })
    expect((await core.commands.sessionDismissStartup({ id: s[0].id })).ok).toBe(true)
    expect(core.getSlices().sessions).toHaveLength(0)
    expect(core.getSlices().projects.some((p) => p.id === wt!.id)).toBe(true)
  })

  it('refuses a feature with a new worktree, before anything is created', async () => {
    const { core, source } = await setup(false)
    const res = await core.commands.sessionCreate({ projectId: source, worktree: { branch: 'feat' }, feature: 'x', kind: 'terminal', cols: 80, rows: 24 })
    expect(res).toEqual({ ok: false, error: 'no-feature' })
    expect(core.getSlices().sessions).toHaveLength(0)
  })
})
