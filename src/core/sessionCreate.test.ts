import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpoolClaude } from './claude/source'
import { claudeArgv } from './claude/hooks'
import { gitRepo } from './testing/gitRepo'
import { setupCore } from './testing/setup'

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
