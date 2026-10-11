import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { keyProjectId, openedKey, projectKey, projectKeys, worktreeKey } from '@shared/groups'
import { DEFAULT_UI, type UiState } from '@shared/types'
import { saveConfig } from './store/configStore'
import { saveState } from './store/stateStore'
import { setupCore } from './testing/setup'

// `ui` remembers a project in three places — the focused page, its collapsed group keys, the
// hidden list — and none of them may outlive it: whether the project was removed here, pruned
// as a dead worktree at start, or dropped from config.json while grove was closed.

describe('group keys', () => {
  it('names each level, and reads the project back out', () => {
    expect(projectKey('x')).toBe('p:x')
    expect(worktreeKey('x')).toBe('w:x')
    expect(openedKey(worktreeKey('x'))).toBe('o:w:x')
    expect(projectKeys('x')).toEqual(['p:x', 'w:x', 'o:w:x'])
    for (const key of projectKeys('x')) expect(keyProjectId(key)).toBe('x')
  })

  it('names no project for a status group or the ungrouped list', () => {
    expect(keyProjectId('s:in-review')).toBe('')
    expect(keyProjectId('all')).toBe('')
    expect(keyProjectId('')).toBe('')
  })
})

describe('forgetting a project', () => {
  let t: ReturnType<typeof setupCore>
  beforeEach(() => { t = setupCore() })
  afterEach(() => t.disposeAll())

  // A previous run's ui, written the way grove writes it: state.json before anything starts.
  const savedUi = (over: Partial<UiState>) =>
    saveState(t.statePath, { schemaVersion: 9, sessions: [], ui: { ...DEFAULT_UI, ...over } })
  const start = async () => {
    const core = t.make()
    await core.start()
    return core
  }
  // a config.json with only project 'p', whatever it held before
  const onlyProjectP = () =>
    saveConfig(t.configPath, { schemaVersion: 1, projects: [{ id: 'p', name: 'proj', path: t.dir }] })
  // ...and one with a second repo, so "leaves the rest alone" has something to leave
  const twoProjects = () => {
    onlyProjectP()
    saveConfig(t.configPath, { schemaVersion: 1, projects: [
      { id: 'p', name: 'proj', path: t.dir },
      { id: 'other', name: 'other', path: path.join(t.dir, 'sub') },
    ] })
  }

  it('drops every ui key naming the removed project, and leaves another repo\'s alone', async () => {
    twoProjects()
    savedUi({
      collapsed: ['p:other', projectKey('p'), worktreeKey('p'), openedKey(worktreeKey('p')), 's:done'],
      hiddenProjects: ['p', 'other'],
      focusedProject: 'p',
    })
    const core = await start()
    expect((await core.commands.projectRemove({ id: 'p' })).ok).toBe(true)
    expect(core.getSlices().ui).toMatchObject({
      collapsed: ['p:other', 's:done'], // p's three keys go; the other repo's and the status group stay
      hiddenProjects: ['other'],
      focusedProject: null,
    })
  })

  it('leaves ui untouched when the project had nothing to forget', async () => {
    const core = await start()
    const before = core.getSlices().ui
    expect((await core.commands.projectRemove({ id: 'p' })).ok).toBe(true)
    expect(core.getSlices().ui.collapsed).toBe(before.collapsed)
    expect(core.getSlices().ui.hiddenProjects).toBe(before.hiddenProjects)
    expect(core.getSlices().ui.focusedProject).toBe(before.focusedProject)
  })

  it('drops keys for projects that are gone at start, whatever removed them', async () => {
    savedUi({ collapsed: ['p:gone', 'o:w:gone', 's:done'], hiddenProjects: ['gone'], focusedProject: 'gone' })
    onlyProjectP() // 'gone' is no longer configured, as after a removal or a pruned worktree
    const core = await start()
    expect(core.getSlices().ui).toMatchObject({ collapsed: ['s:done'], hiddenProjects: [], focusedProject: null })
  })

  it('keeps the keys of projects that are still registered', async () => {
    savedUi({ collapsed: ['p:p', 's:backlog'], hiddenProjects: ['p'], focusedProject: 'p' })
    const core = await start()
    expect(core.getSlices().ui).toMatchObject({ collapsed: ['p:p', 's:backlog'], hiddenProjects: ['p'], focusedProject: 'p' })
  })

  it('writes the pruned ui back, so the next start does not see it again', async () => {
    savedUi({ collapsed: ['p:gone'], hiddenProjects: ['gone'] })
    onlyProjectP()
    await start()
    const saved = JSON.parse(fs.readFileSync(t.statePath, 'utf8'))
    expect(saved.ui.collapsed).toEqual([])
    expect(saved.ui.hiddenProjects).toEqual([])
  })
})