import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig, saveConfig } from './store/configStore'
import { loadState } from './store/stateStore'
import { createTerminal, setupCore } from './testing/setup'

describe('projectRemove', () => {
  let disposeAll = () => {}
  afterEach(() => disposeAll())

  function setup() {
    const s = setupCore()
    disposeAll = s.disposeAll
    return s
  }

  it('refuses while the project has running sessions', async () => {
    const { make } = setup()
    const a = make()
    await a.start()
    await createTerminal(a)
    expect(await a.commands.projectRemove({ id: 'p' })).toEqual({ ok: false, error: 'has-live-sessions' })
    expect(a.getSlices().projects).toHaveLength(1)
  })

  it('removes the project and its gone sessions', async () => {
    const { make, configPath, statePath } = setup()
    const a = make()
    await a.start()
    const s = await createTerminal(a)
    await a.commands.uiSet({ focusedSessionId: s.id })
    await a.commands.sessionKill({ id: s.id })
    expect(await a.commands.projectRemove({ id: 'p' })).toEqual({ ok: true, data: { id: 'p' } })
    expect(loadConfig(configPath).projects).toEqual([])
    expect(loadState(statePath).sessions).toEqual([])
    expect(a.getSlices().ui.focusedSessionId).toBeNull()
  })

  it('returns not-found for an unknown id', async () => {
    const { make } = setup()
    const a = make()
    await a.start()
    expect(await a.commands.projectRemove({ id: 'x' })).toEqual({ ok: false, error: 'not-found' })
  })

  // A worktree is its own project, so removing its parent would take the home of a session that
  // is still running in it. Refuse until that child is idle.
  it('refuses while a worktree child has a running session, and allows it once the session is gone', async () => {
    const s = setup()
    const dir = fs.mkdtempSync(path.join(s.dir, '..', 'wt-'))
    saveConfig(s.configPath, {
      schemaVersion: 1,
      projects: [
        { id: 'p', name: 'proj', path: s.dir },
        { id: 'wt', name: 'proj · wt', path: dir, worktreeOf: 'p' },
      ],
    })
    const a = s.make()
    await a.start()
    const session = await createTerminal(a, 'wt')

    expect(await a.commands.projectRemove({ id: 'p' })).toEqual({ ok: false, error: 'has-live-sessions' })
    expect(a.getSlices().projects.map((p) => p.id)).toEqual(['p', 'wt'])

    await a.commands.sessionKill({ id: session.id })
    expect(await a.commands.projectRemove({ id: 'p' })).toEqual({ ok: true, data: { id: 'p' } })
    expect(a.getSlices().projects.map((p) => p.id)).toEqual(['wt']) // the child outlives its parent
    expect(fs.existsSync(dir)).toBe(true) // unregistering a worktree never deletes its checkout
  })
})

describe('config sounds', () => {
  let disposeAll = () => {}
  afterEach(() => disposeAll())

  it('is on by default', async () => {
    const s = setupCore()
    disposeAll = s.disposeAll
    const a = s.make()
    await a.start()
    expect(a.soundsOn()).toBe(true)
  })

  it('reads sounds: false and keeps it when the projects are saved', async () => {
    const s = setupCore()
    disposeAll = s.disposeAll
    saveConfig(s.configPath, { ...loadConfig(s.configPath), sounds: false })
    const a = s.make()
    await a.start()
    expect(a.soundsOn()).toBe(false)
    expect(await a.commands.projectRemove({ id: 'p' })).toEqual({ ok: true, data: { id: 'p' } })
    expect(loadConfig(s.configPath).sounds).toBe(false)
  })
})
