import fs from 'node:fs'
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

  it('reports git not found', async () => {
    s = setupCore()
    const core = s.make(undefined, { git: null })
    await core.start()
    const session = await createTerminal(core)
    await core.commands.uiSet({ viewer: { kind: 'diff', sessionId: session.id } })
    await vi.waitFor(() => expect(core.getSlices().diff).toMatchObject({ state: 'error', error: 'git not found' }))
  })
})
