import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig, saveConfig } from './store/configStore'
import { setupCore } from './testing/setup'

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
})
