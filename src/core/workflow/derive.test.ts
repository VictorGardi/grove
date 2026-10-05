import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { FolderSnapshot } from '../discovery/folder'
import { readFrontmatter } from './frontmatter'
import { deriveFeatures, effectiveStages, isComplete } from './derive'
import { parseWorkflow, type Workflow } from './parse'

const res = parseWorkflow(fs.readFileSync(new URL('../../../resources/workflow.yaml', import.meta.url), 'utf8'))
if (!res.ok) throw new Error(res.error)
const wf: Workflow = res.workflow

// A folder from file name → content; `feature.md` is the manifest.
function folder(slug: string, files: Record<string, string>): FolderSnapshot & { projectId: string } {
  const { 'feature.md': manifest = '', ...rest } = files
  const artifacts = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, readFrontmatter(v)]))
  return { projectId: 'p', slug, path: `/x/${slug}`, manifest: readFrontmatter(manifest), files: Object.keys(files).sort(), artifacts }
}
const fm = (fields: string) => `---\n${fields}\n---\n`
const approved = fm('status: approved')
const ids = (m: Record<string, unknown>) => effectiveStages(wf, m).map((s) => s.id)

describe('effectiveStages', () => {
  it('intersects the kind and the flow', () => {
    expect(ids({ kind: 'epic' })).toEqual(['questions', 'research', 'design', 'structure'])
    expect(ids({ flow: 'small' })).toEqual(['questions', 'implementation'])
    expect(ids({ kind: 'epic', flow: 'small' })).toEqual(['questions'])
  })

  it('uses the defaults for a missing kind and flow', () => {
    expect(ids({})).toEqual(['questions', 'research', 'design', 'structure', 'implementation'])
  })
})

describe('isComplete', () => {
  const f = folder('a', { '01-questions.md': fm('status: approved'), '05-plan.md': '- [x] a\n- [ ] b\n' })
  it.each([
    [{ exists: true as const }, '01-questions.md', true],
    [{ exists: true as const }, '02-research.md', false],
    [{ field: 'status', equals: 'approved' }, '01-questions.md', true],
    [{ field: 'status', in: ['draft', 'stale'] }, '01-questions.md', false],
    [{ all_checked: '05-plan.md' }, '06-implementation.md', false],
  ])('%j on %s → %s', (p, artifact, expected) => {
    expect(isComplete(p, f, artifact)).toBe(expected)
  })

  it('all_checked needs a ticked box and no open one', () => {
    expect(isComplete({ all_checked: '05-plan.md' }, folder('b', { '05-plan.md': '- [x] a\n- [X] b\n' }), 'x')).toBe(true)
    expect(isComplete({ all_checked: '05-plan.md' }, folder('c', { '05-plan.md': 'no boxes' }), 'x')).toBe(false)
  })
})

describe('deriveFeatures', () => {
  it('makes the first incomplete stage current', () => {
    const [f] = deriveFeatures(wf, [folder('a', { 'feature.md': '# A feature\n', '01-questions.md': approved, '02-research.md': fm('status: draft') })], [])
    expect(f.currentStage).toBe('research')
    expect(f.stages.map((s) => s.state)).toEqual(['complete', 'current', 'upcoming', 'upcoming', 'upcoming'])
    expect(f.title).toBe('A feature')
    expect(f.stages[1]).toMatchObject({ artifact: '02-research.md', review: '02-research.html' })
  })

  it('is done when every effective stage is complete', () => {
    const [f] = deriveFeatures(wf, [folder('a', { 'feature.md': fm('flow: small'), '01-questions.md': approved, '06-implementation.md': approved })], [])
    expect(f.currentStage).toBeNull()
    expect(f.stages.map((s) => [s.id, s.state])).toEqual([['questions', 'complete'], ['implementation', 'complete']])
    expect(f.flow).toBe('small')
  })

  it('reads kind, group and parent and falls back to the slug for a title', () => {
    const out = deriveFeatures(wf, [
      folder('b-child', { 'feature.md': fm('parent: a-epic') }),
      folder('a-epic', { 'feature.md': fm('kind: epic') }),
    ], [])
    expect(out.map((f) => [f.slug, f.kind, f.group, f.parent, f.flow, f.title])).toEqual([
      ['a-epic', 'epic', true, null, null, 'a-epic'],
      ['b-child', 'feature', false, 'a-epic', null, 'b-child'],
    ])
  })
})
