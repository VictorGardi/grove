import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from './store/configStore'
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
})
