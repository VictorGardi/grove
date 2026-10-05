import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setupCore } from './testing/setup'

describe('core features', () => {
  let disposeAll = () => {}
  afterEach(() => disposeAll())

  it('derives features from the project at start and never persists them', async () => {
    const s = setupCore()
    disposeAll = s.disposeAll
    const dir = path.join(s.dir, 'docs', 'work', 'a')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'feature.md'), '---\nkind: feature\n---\n# A\n')
    fs.writeFileSync(path.join(dir, '01-questions.md'), '---\nstatus: approved\n---\n')

    const core = s.make()
    await core.start()
    const { features } = core.getSlices()
    expect(features.workflowError).toBeNull()
    expect(features.items).toMatchObject([{ projectId: 'p', slug: 'a', title: 'A', currentStage: 'research' }])
    expect(features.stages.map((x) => x.id)).toEqual(['questions', 'research', 'design', 'structure', 'implementation'])

    await core.commands.uiSet({ sidebarWidth: 300 }) // forces a state write
    expect(JSON.parse(fs.readFileSync(s.statePath, 'utf8'))).not.toHaveProperty('features')
  })
})
