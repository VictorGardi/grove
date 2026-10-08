import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTerminal, setupCore } from '../testing/setup'
import { gitRepo } from '../testing/gitRepo'

let s: ReturnType<typeof setupCore>
afterEach(() => s.disposeAll())

// The project folder is the repo; grove's own files in it are ignored.
async function setup() {
  s = setupCore()
  const repo = gitRepo(s.dir)
  repo.write('.gitignore', '*.json\nagents/\n')
  repo.write('a.txt', 'one\ntwo\n')
  repo.commit()
  const core = s.make()
  await core.start()
  const session = await createTerminal(core)
  return { core, repo, session }
}

describe('core session diff', () => {
  it('computes the diff while the viewer shows it, and drops it when closed', async () => {
    const { core, repo, session } = await setup()
    repo.write('a.txt', 'one\nTWO\n')
    await core.commands.uiSet({ viewer: { kind: 'diff', sessionId: session.id } })
    await vi.waitFor(() => expect(core.getSlices().diff?.files).toHaveLength(1))
    expect(core.getSlices().diff).toMatchObject({ sessionId: session.id, projectId: 'p', state: 'ok' })
    await core.commands.uiSet({ viewer: null })
    expect(core.getSlices().diff).toBeNull()
  })

  it('never saves the diff, and keeps the diff viewer', async () => {
    const { core, repo, session } = await setup()
    repo.write('a.txt', 'changed\n')
    await core.commands.uiSet({ viewer: { kind: 'diff', sessionId: session.id } })
    await vi.waitFor(() => expect(core.getSlices().diff).not.toBeNull())
    const saved = JSON.parse(fs.readFileSync(s.statePath, 'utf8'))
    expect(saved).not.toHaveProperty('diff')
    expect(saved.ui.viewer).toEqual({ kind: 'diff', sessionId: session.id })
  })

  it('recomputes a saved diff viewer on start', async () => {
    const { core, repo, session } = await setup()
    await core.commands.uiSet({ viewer: { kind: 'diff', sessionId: session.id } })
    repo.write('a.txt', 'changed\n')
    s.disposeAll()
    const again = s.make()
    await again.start()
    await vi.waitFor(() => expect(again.getSlices().diff?.files).toHaveLength(1))
  })

  it('follows edits on the tick, and pushes nothing while unchanged', async () => {
    const { core, repo, session } = await setup()
    repo.write('a.txt', 'one\nTWO\n')
    await core.commands.uiSet({ viewer: { kind: 'diff', sessionId: session.id } })
    await vi.waitFor(() => expect(core.getSlices().diff?.files).toHaveLength(1))
    let pushes = 0
    core.on('slice', (k) => { if (k === 'diff') pushes++ })
    await core.checkLiveness()
    await core.checkLiveness()
    repo.write('a.txt', 'ONE\nTWO\n')
    await core.checkLiveness()
    await vi.waitFor(() => expect(core.getSlices().diff?.files[0].additions).toBe(2))
    await new Promise((r) => setTimeout(r, 100)) // let any queued rerun settle
    expect(pushes).toBe(1) // the unchanged ticks pushed nothing
  })

  it('recomputes on an agent write', async () => {
    const { core, repo, session } = await setup()
    await core.commands.uiSet({ viewer: { kind: 'diff', sessionId: session.id } })
    await vi.waitFor(() => expect(core.getSlices().diff?.files).toEqual([]))
    repo.write('a.txt', 'written\n')
    s.claude.emit({ type: 'wrote', sessionId: 'other', paths: [`${s.dir}/a.txt`] })
    await vi.waitFor(() => expect(core.getSlices().diff?.files).toHaveLength(1))
  })

  it("closes the diff when its session is removed, and drops a doc's fromDiff", async () => {
    const { core, session } = await setup()
    await core.commands.uiSet({ viewer: { kind: 'diff', sessionId: session.id } })
    await vi.waitFor(() => expect(core.getSlices().diff).not.toBeNull())
    await core.commands.sessionKill({ id: session.id })
    await core.commands.sessionRemove({ id: session.id })
    expect(core.getSlices().ui.viewer).toBeNull()
    expect(core.getSlices().diff).toBeNull()

    const other = await createTerminal(core)
    const doc = { kind: 'file' as const, projectId: 'p', path: 'x.md', hash: null, fromDiff: other.id }
    await core.commands.uiSet({ viewer: doc })
    await core.commands.sessionKill({ id: other.id })
    await core.commands.sessionRemove({ id: other.id })
    expect(core.getSlices().ui.viewer).toEqual({ ...doc, fromDiff: null })
  })

  it('serves project files through filePath and refuses escapes', async () => {
    const { core, repo } = await setup()
    repo.write('docs/adr/x.md', '# x\n')
    fs.symlinkSync('/etc/hosts', path.join(s.dir, 'docs', 'out.md'))
    expect(core.filePath('p', 'docs/adr/x.md')).toBe(fs.realpathSync(path.join(s.dir, 'docs/adr/x.md')))
    for (const rel of ['../x.md', '.git/HEAD', 'docs/out.md', 'docs/missing.md', 'docs/adr', '/etc/hosts']) {
      expect(core.filePath('p', rel), rel).toBeNull()
    }
    expect(core.filePath('nope', 'docs/adr/x.md')).toBeNull()
  })

  it('reports git not found', async () => {
    s = setupCore()
    const core = s.make(undefined, { git: null })
    await core.start()
    const session = await createTerminal(core)
    await core.commands.uiSet({ viewer: { kind: 'diff', sessionId: session.id } })
    await vi.waitFor(() => expect(core.getSlices().diff).toMatchObject({ state: 'error', error: 'git not found' }))
  })

  it('diffs since a chosen base once committed work would otherwise vanish from the diff', async () => {
    const { core, repo, session } = await setup()
    repo.git('checkout', '-b', 'feature')
    repo.write('a.txt', 'one\ncommitted\n')
    repo.commit('on feature')
    await core.commands.uiSet({ viewer: { kind: 'diff', sessionId: session.id } })
    await vi.waitFor(() => expect(core.getSlices().diff?.state).toBe('ok'))
    expect(core.getSlices().diff?.files).toEqual([]) // fully committed: nothing against plain HEAD

    await core.commands.uiSet({ viewer: { kind: 'diff', sessionId: session.id, base: 'main' } })
    await vi.waitFor(() => expect(core.getSlices().diff?.files).toHaveLength(1))
    expect(core.getSlices().diff).toMatchObject({ base: 'main' })

    // switching back to the working tree drops it again
    await core.commands.uiSet({ viewer: { kind: 'diff', sessionId: session.id, base: null } })
    await vi.waitFor(() => expect(core.getSlices().diff?.files).toEqual([]))
  })
})

describe('core diffRefs', () => {
  it('lists local branches and the detected default branch', async () => {
    const { core, repo, session } = await setup()
    repo.git('branch', 'feature')
    const res = await core.commands.diffRefs({ sessionId: session.id })
    expect(res).toEqual({ ok: true, data: { branches: ['feature', 'main'], default: 'main' } })
  })

  it('fails for an unknown session', async () => {
    const { core } = await setup()
    expect(await core.commands.diffRefs({ sessionId: 'nope' })).toEqual({ ok: false, error: 'not-found' })
  })

  it('is ok with nothing to offer outside a repo', async () => {
    s = setupCore() // no gitRepo(): the project folder isn't a repo
    const core = s.make()
    await core.start()
    const session = await createTerminal(core)
    expect(await core.commands.diffRefs({ sessionId: session.id })).toEqual({ ok: true, data: { branches: [], default: null } })
  })
})

describe('core diffLines', () => {
  it('reads unmodified lines of a changed file in the open diff, and nothing else', async () => {
    s = setupCore()
    const repo = gitRepo(s.dir)
    repo.write('.gitignore', '*.json\nagents/\n')
    repo.write('a.txt', Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n')
    repo.write('b.txt', 'b\n')
    repo.commit()
    repo.write('a.txt', Array.from({ length: 30 }, (_, i) => (i === 14 ? 'CHANGED' : `line ${i + 1}`)).join('\n') + '\n')
    const core = s.make()
    await core.start()
    const session = await createTerminal(core)
    await core.commands.uiSet({ viewer: { kind: 'diff', sessionId: session.id } })
    await vi.waitFor(() => expect(core.getSlices().diff?.files).toHaveLength(1))
    expect(await core.commands.diffLines({ sessionId: session.id, path: 'a.txt', from: 2, to: 4 })).toEqual({ ok: true, data: ['line 2', 'line 3', 'line 4'] })
    expect((await core.commands.diffLines({ sessionId: session.id, path: 'b.txt', from: 1, to: 1 }))).toEqual({ ok: false, error: 'not-found' })
    expect((await core.commands.diffLines({ sessionId: session.id, path: '../x', from: 1, to: 1 }))).toEqual({ ok: false, error: 'not-found' })
    expect((await core.commands.diffLines({ sessionId: session.id, path: 'a.txt', from: 5, to: 2 }))).toEqual({ ok: false, error: 'bad-range' })
    expect((await core.commands.diffLines({ sessionId: 'nope', path: 'a.txt', from: 1, to: 1 }))).toEqual({ ok: false, error: 'not-found' })
  })
})
