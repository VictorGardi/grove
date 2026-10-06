import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FeaturesSlice } from '@shared/types'
import { loadConfig, saveConfig } from './store/configStore'
import { createTerminal, setupCore } from './testing/setup'

const bundled = fs.readFileSync(new URL('../../resources/workflow.yaml', import.meta.url), 'utf8')

describe('core features', () => {
  let disposeAll = () => {}
  afterEach(() => disposeAll())

  function setup() {
    const s = setupCore()
    disposeAll = s.disposeAll
    const work = path.join(s.dir, 'docs', 'work')
    const feature = (slug: string, root = work) => {
      fs.mkdirSync(path.join(root, slug), { recursive: true })
      fs.writeFileSync(path.join(root, slug, 'feature.md'), `---\nkind: feature\n---\n# ${slug}\n`)
    }
    // Point config.json at a custom workflow file with the given content.
    const customWorkflow = (text: string) => {
      const file = path.join(s.dir, 'custom.yaml')
      fs.writeFileSync(file, text)
      saveConfig(s.configPath, { ...loadConfig(s.configPath), workflow: file })
      return file
    }
    return { ...s, work, feature, customWorkflow }
  }
  const slugs = (core: { getSlices(): { features: { items: { slug: string }[] } } }) =>
    core.getSlices().features.items.map((f) => f.slug)

  it('derives features from the project at start and never persists them', async () => {
    const s = setup()
    s.feature('a')
    fs.writeFileSync(path.join(s.work, 'a', '01-questions.md'), '---\nstatus: approved\n---\n')

    const core = s.make()
    await core.start()
    const { features } = core.getSlices()
    expect(features.workflowError).toBeNull()
    expect(features.items).toMatchObject([{ projectId: 'p', slug: 'a', title: 'a', currentStage: 'research' }])
    expect(features.stages.map((x) => x.id)).toEqual(['questions', 'research', 'design', 'structure', 'implementation'])

    await core.commands.uiSet({ sidebarWidth: 300 }) // forces a state write
    expect(JSON.parse(fs.readFileSync(s.statePath, 'utf8'))).not.toHaveProperty('features')
  })

  it('updates an artifact mtimeMs when its file changes', async () => {
    const s = setup()
    s.feature('a')
    const file = path.join(s.work, 'a', 'x.md')
    fs.writeFileSync(file, 'one\n')
    fs.utimesSync(file, new Date('2026-01-01'), new Date('2026-01-01'))
    const core = s.make()
    await core.start()
    const pushed: FeaturesSlice[] = []
    core.on('slice', (k, v) => { if (k === 'features') pushed.push(v as FeaturesSlice) })
    const mtime = (f: FeaturesSlice) => f.items[0].artifacts.find((a) => a.name === 'x.md')!.mtimeMs
    const before = mtime(core.getSlices().features)

    fs.writeFileSync(file, 'two\n')
    fs.utimesSync(file, new Date('2026-02-01'), new Date('2026-02-01'))
    s.watchers.roots.get(s.work)!('a')
    expect(mtime(pushed.at(-1)!)).toBe(new Date('2026-02-01').getTime())
    expect(mtime(pushed.at(-1)!)).not.toBe(before)
  })

  it('re-reads a folder when its watcher fires', async () => {
    const s = setup()
    s.feature('a')
    const core = s.make()
    await core.start()
    s.feature('b')
    s.watchers.roots.get(s.work)!('b')
    expect(slugs(core)).toEqual(['a', 'b'])
    fs.rmSync(path.join(s.work, 'a'), { recursive: true })
    s.watchers.roots.get(s.work)!('a')
    expect(slugs(core)).toEqual(['b'])
  })

  it('re-roots when the from_file key changes', async () => {
    const s = setup()
    s.feature('a')
    const other = path.join(s.dir, 'elsewhere')
    s.feature('z', other)
    const core = s.make()
    await core.start()
    const cfg = path.join(s.dir, 'grove.config.json')
    fs.writeFileSync(cfg, JSON.stringify({ artifactRoot: 'elsewhere' }))
    s.watchers.files.get(cfg)!()
    expect(slugs(core)).toEqual(['z'])
    expect(s.watchers.roots.has(s.work)).toBe(false)
    expect(s.watchers.roots.has(other)).toBe(true)
  })

  it('picks up a root that appears later on the next sync', async () => {
    const s = setup()
    const core = s.make()
    await core.start()
    expect(slugs(core)).toEqual([])
    s.feature('a')
    await core.commands.projectAdd({ path: path.join(s.dir, 'none') }) // any sync will do
    expect(slugs(core)).toEqual(['a'])
  })

  it('uses a custom workflow and keeps it in config.json', async () => {
    const s = setup()
    s.feature('a')
    s.customWorkflow(bundled.replace('label: Questions', 'label: Asking'))
    const core = s.make()
    await core.start()
    expect(core.getSlices().features.stages[0].label).toBe('Asking')
    await core.commands.projectAdd({ path: s.dir })
    expect(loadConfig(s.configPath).workflow).toBe(path.join(s.dir, 'custom.yaml'))
  })

  it('keeps the last valid workflow while the file is broken', async () => {
    const s = setup()
    s.feature('a')
    const file = s.customWorkflow(bundled)
    const core = s.make()
    await core.start()

    fs.writeFileSync(file, 'stages: [\n')
    s.watchers.files.get(file)!()
    expect(core.getSlices().features.workflowError).toContain(file)
    expect(slugs(core)).toEqual(['a'])

    fs.writeFileSync(file, bundled)
    s.watchers.files.get(file)!()
    expect(core.getSlices().features.workflowError).toBeNull()
    expect(slugs(core)).toEqual(['a'])
  })

  it('shows no features and an error when the workflow is broken at start', async () => {
    const s = setup()
    s.feature('a')
    s.customWorkflow('stages: [\n')
    const core = s.make()
    await core.start()
    expect(core.getSlices().features.items).toEqual([])
    expect(core.getSlices().features.workflowError).toEqual(expect.any(String))
  })

  it('keeps the focused feature and the focused session exclusive', async () => {
    const s = setup()
    const core = s.make()
    await core.start()
    await core.commands.uiSet({ focusedSessionId: 'x' })
    await core.commands.uiSet({ focusedFeature: { projectId: 'p', slug: 'a' } })
    expect(core.getSlices().ui).toMatchObject({ focusedSessionId: null, focusedFeature: { projectId: 'p', slug: 'a' } })
    await core.commands.uiSet({ focusedSessionId: 'y' })
    expect(core.getSlices().ui).toMatchObject({ focusedSessionId: 'y', focusedFeature: null })
  })

  it('links a session to a feature by hand and keeps it across restarts', async () => {
    const s = setup()
    s.feature('a')
    const core = s.make()
    await core.start()
    const t = await createTerminal(core)
    const res = await core.commands.sessionLink({ id: t.id, feature: 'a' })
    expect(res).toMatchObject({ ok: true, data: { id: t.id, feature: 'a', linkPinned: true } })
    expect(core.getSlices().features.items[0].cardState).toBe('backlog') // a terminal never makes a card running

    const again = s.make()
    await again.start()
    expect(again.getSlices().sessions[0]).toMatchObject({ feature: 'a', linkPinned: true })
  })

  it('unlinks with null and still pins', async () => {
    const s = setup()
    s.feature('a')
    const core = s.make()
    await core.start()
    const t = await createTerminal(core)
    await core.commands.sessionLink({ id: t.id, feature: 'a' })
    const res = await core.commands.sessionLink({ id: t.id, feature: null })
    expect(res).toMatchObject({ ok: true, data: { feature: null, linkPinned: true } })
    expect(core.getSlices().features.items[0].cardState).toBe('backlog')
  })

  it('refuses an unknown session, an unknown slug and another project\'s feature', async () => {
    const s = setup()
    s.feature('a')
    const other = path.join(s.dir, 'other')
    s.feature('b', path.join(other, 'docs', 'work'))
    const config = loadConfig(s.configPath)
    saveConfig(s.configPath, { ...config, projects: [...config.projects, { id: 'q', name: 'other', path: other }] })
    const core = s.make()
    await core.start()
    expect(core.getSlices().features.items.map((f) => [f.projectId, f.slug])).toEqual([['p', 'a'], ['q', 'b']])
    const t = await createTerminal(core)
    const nf = { ok: false, error: 'not-found' }
    expect(await core.commands.sessionLink({ id: 'x', feature: 'a' })).toEqual(nf)
    expect(await core.commands.sessionLink({ id: t.id, feature: 'nope' })).toEqual(nf)
    expect(await core.commands.sessionLink({ id: t.id, feature: 'b' })).toEqual(nf)
    expect(core.getSlices().sessions[0]).toMatchObject({ feature: null, linkPinned: false })
  })
})
