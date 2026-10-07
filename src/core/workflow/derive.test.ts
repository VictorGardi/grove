import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { FolderSnapshot } from '../discovery/folder'
import type { Session } from '@shared/types'
import { newSession } from '../sessions'
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
  return { projectId: 'p', slug, path: `/x/${slug}`, manifest: readFrontmatter(manifest), files: Object.keys(files).sort(), mtimes: {}, artifacts }
}
const fm = (fields: string) => `---\n${fields}\n---\n`
const approved = fm('status: approved')
const session = (over: Partial<Session>): Session =>
  ({ ...newSession({ projectId: 'p', kind: 'terminal', now: new Date(0), id: 's', agentSessionId: null }), feature: 'a', ...over })
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

  it('passes an incomplete stage when a later artifact exists ("unapproved")', () => {
    const [f] = deriveFeatures(wf, [folder('a', { 'feature.md': '', '01-questions.md': fm('status: draft'), '02-research.md': approved })], [])
    expect(f.stages.map((s) => [s.id, s.state])).toEqual([
      ['questions', 'unapproved'], ['research', 'complete'], ['design', 'current'], ['structure', 'upcoming'], ['implementation', 'upcoming'],
    ])
    expect(f.currentStage).toBe('design')
    expect(f.cardState).toBe('ready')
  })

  it('leaves stages the flow skips off the timeline, even if their files exist', () => {
    const [f] = deriveFeatures(wf, [folder('a', { 'feature.md': fm('flow: small'), '01-questions.md': fm('status: draft'), '02-research.md': approved })], [])
    expect(f.stages.map((s) => [s.id, s.state])).toEqual([['questions', 'current'], ['implementation', 'upcoming']])
    expect(f.cardState).toBe('needs-review')
  })

  it('sets the stale flag from any stage artifact', () => {
    const [f] = deriveFeatures(wf, [folder('a', { 'feature.md': '', '01-questions.md': approved, '02-research.md': fm('status: stale') })], [])
    expect(f.flags).toEqual([{ id: 'stale', label: 'Stale' }])
  })

  it('warns about an unknown flow and broken frontmatter', () => {
    const [f] = deriveFeatures(wf, [folder('a', { 'feature.md': fm('flow: weird'), '01-questions.md': '---\nstatus: x\n' })], [])
    expect(f.stages).toHaveLength(5)
    expect(f.warnings).toEqual(['flow?', 'frontmatter?: 01-questions.md'])
  })

  it.each<[string, Record<string, string>, string]>([
    ['backlog', {}, 'backlog'],
    ['ready', { '01-questions.md': approved }, 'ready'],
    ['needs-review', { '01-questions.md': approved, '06-implementation.md': fm('status: draft') }, 'needs-review'],
    ['done', { '01-questions.md': approved, '06-implementation.md': approved }, 'done'],
    ['done with an unapproved pass', { '01-questions.md': fm('status: draft'), '06-implementation.md': approved }, 'done'],
  ])('card state %s', (_, files, expected) => {
    const [f] = deriveFeatures(wf, [folder('a', { 'feature.md': fm('flow: small'), ...files })], [])
    expect(f.cardState).toBe(expected)
  })

  it.each<[string, Record<string, string>, Partial<Session>, string]>([
    ['not running with a live terminal', { '01-questions.md': approved }, {}, 'ready'],
    ['running with a working OpenCode session', { '01-questions.md': approved }, { kind: 'opencode', status: 'working' }, 'running'],
    ['not running with an idle OpenCode session', { '01-questions.md': approved }, { kind: 'opencode', status: 'idle' }, 'ready'],
    ['waiting with a waiting OpenCode session', { '01-questions.md': approved }, { kind: 'opencode', status: 'waiting', waitingFor: 'question' }, 'waiting'],
    ['not waiting when the session is gone', { '01-questions.md': approved }, { kind: 'opencode', status: 'waiting', lastStatus: 'gone' }, 'ready'],
    ['not running with a session in another project', { '01-questions.md': approved }, { kind: 'opencode', status: 'working', projectId: 'q' }, 'ready'],
    ['done even with a working session', { '01-questions.md': approved, '06-implementation.md': approved }, { kind: 'opencode', status: 'working' }, 'done'],
  ])('card state: %s', (_, files, over, expected) => {
    const [f] = deriveFeatures(wf, [folder('a', { 'feature.md': fm('flow: small'), ...files })], [session(over)])
    expect(f.cardState).toBe(expected)
  })

  it('card state: waiting beats running', () => {
    const [f] = deriveFeatures(wf, [folder('a', { 'feature.md': fm('flow: small'), '01-questions.md': approved })], [
      session({ id: 'w', kind: 'opencode', status: 'working' }),
      session({ id: 'q', kind: 'opencode', status: 'waiting', waitingFor: 'permission' }),
    ])
    expect(f.cardState).toBe('waiting')
  })

  describe('groups', () => {
    const epicDone = { 'feature.md': fm('kind: epic'), '01-questions.md': approved, '02-research.md': approved, '03-design.md': approved, '04-structure.md': approved }
    const child = (slug: string, done: boolean, over = '') =>
      folder(slug, { 'feature.md': fm(`parent: e${over}\nflow: small`), '01-questions.md': approved, ...(done && { '06-implementation.md': approved }) })
    const epic = (out: ReturnType<typeof deriveFeatures>) => out.find((f) => f.slug === 'e')!

    it('is active with progress while some children are unfinished', () => {
      const e = epic(deriveFeatures(wf, [folder('e', epicDone), child('a', true), child('b', false)], []))
      expect(e.cardState).toBe('active')
      expect(e.currentStage).toBeNull()
      expect(e.progress).toEqual({ done: 1, total: 2 })
    })

    it('is done once every child is done', () => {
      const e = epic(deriveFeatures(wf, [folder('e', epicDone), child('a', true), child('b', true)], []))
      expect(e.cardState).toBe('done')
      expect(e.progress).toEqual({ done: 2, total: 2 })
    })

    it('is done by its own stages with no children, and ignores other projects', () => {
      const other = { ...child('a', false), projectId: 'q' }
      const e = epic(deriveFeatures(wf, [folder('e', epicDone), other], []))
      expect(e.cardState).toBe('done')
      expect(e.progress).toBeNull()
    })

    it('keeps the usual rules before its own stages complete', () => {
      const e = epic(deriveFeatures(wf, [folder('e', { 'feature.md': fm('kind: epic'), '01-questions.md': approved }), child('a', true)], []))
      expect(e.cardState).toBe('ready')
      expect(e.progress).toEqual({ done: 1, total: 1 })
    })

    it('counts a nested group as done only when its own children are', () => {
      const mid = folder('m', { ...epicDone, 'feature.md': fm('kind: epic\nparent: e') })
      const leaf = folder('l', { 'feature.md': fm('parent: m\nflow: small'), '01-questions.md': approved })
      const out = deriveFeatures(wf, [folder('e', epicDone), mid, leaf], [])
      expect(out.find((f) => f.slug === 'm')!.cardState).toBe('active')
      expect(epic(out)).toMatchObject({ cardState: 'active', progress: { done: 0, total: 1 } })
    })

    it('gives non-groups no progress', () => {
      const out = deriveFeatures(wf, [folder('e', epicDone), child('a', true)], [])
      expect(out.find((f) => f.slug === 'a')!.progress).toBeNull()
    })
  })

  it('tags files with their stage and role', () => {
    const [f] = deriveFeatures(wf, [folder('a', { 'feature.md': '', '02-research.md': approved, '02-research.html': '', 'notes.md': '' })], [])
    expect(f.artifacts).toEqual([
      { name: '02-research.html', stage: 'research', role: 'review', mtimeMs: 0 },
      { name: '02-research.md', stage: 'research', role: 'artifact', mtimeMs: 0 },
      { name: 'feature.md', stage: null, role: null, mtimeMs: 0 },
      { name: 'notes.md', stage: null, role: null, mtimeMs: 0 },
    ])
  })
})
