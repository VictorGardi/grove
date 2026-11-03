import { describe, expect, it } from 'vitest'
import { DEFAULT_UI, type Feature, type Project, type UiState } from '@shared/types'
import { artifactClusters, artifactCrumbs, commentCard, findCard, neighbours, openCard, pageClusters, stepKey } from './artifactData'
import { unionFeatures } from './featureUnion'
import { repoGroups } from './repoGroups'

const projects: Project[] = [
  { id: 'p', name: 'grove', path: '/src/p' },
  { id: 'wt', name: 'grove · fix-auth', path: '/src/wt', worktreeOf: 'p' },
]
const stages = [{ id: 'questions', label: 'Questions' }, { id: 'research', label: 'Research' }, { id: 'design', label: 'Design' }]

type A = Feature['artifacts'][number]
const md = (name: string, stage: string | null, mtimeMs = 1): A => ({ name, stage, role: 'artifact', mtimeMs })
const html = (name: string, stage: string | null, mtimeMs = 2): A => ({ name, stage, role: 'review', mtimeMs })

const feature = (slug: string, over: Partial<Feature> = {}): Feature => ({
  projectId: 'p', slug, path: '/src/p/docs/work/' + slug, title: 'T' + slug, kind: 'feature',
  flow: null, stages: stages.map((st) => ({ ...st, artifact: st.id + '.md', review: null, state: 'upcoming' as const })),
  currentStage: 'questions', cardState: 'ready', flags: [], warnings: [], artifacts: [], ...over,
})

const clusters = (features: Feature[]) => artifactClusters(stages, features, projects)
const names = (features: Feature[]) => clusters(features).map((c) => [c.feature.slug, c.cards.map((k) => k.name)])

describe('artifactClusters', () => {
  it('groups cards by feature, in stage order then name, unknown stages last', () => {
    const f = feature('a', { artifacts: [md('notes.md', null), md('03-design.md', 'design'), md('01-questions.md', 'questions'), md('00-ticket.md', 'questions')] })
    expect(names([f])).toEqual([['a', ['00-ticket.md', '01-questions.md', '03-design.md', 'notes.md']]])
  })

  it('folds an html review into its markdown: the card keeps the name, opens the html, and carries the markdown', () => {
    const f = feature('a', { artifacts: [md('02-research.md', 'research', 5), html('02-research.html', 'research', 9)] })
    expect(clusters([f])[0].cards).toEqual([{ name: '02-research.md', path: 'docs/work/a/02-research.html', stage: 'research', mtimeMs: 9,
      source: { path: 'docs/work/a/02-research.md', mtimeMs: 5 } }])
  })

  it('opens the markdown itself when it has no html, and keeps an html with no markdown as its own card', () => {
    const f = feature('a', { artifacts: [md('01-questions.md', 'questions'), html('mockup.html', 'design')] })
    expect(clusters([f])[0].cards.map((c) => [c.name, c.path, c.source])).toEqual([
      ['01-questions.md', 'docs/work/a/01-questions.md', null],
      ['mockup.html', 'docs/work/a/mockup.html', null],
    ])
  })

  it('gives non-viewable files no card, and a feature without cards no cluster', () => {
    const f = feature('a', { artifacts: [md('01-questions.md', 'questions'), { name: 'data.json', stage: null, role: null, mtimeMs: 1 }] })
    const empty = feature('b', { artifacts: [{ name: 'run.log', stage: null, role: null, mtimeMs: 1 }] })
    expect(names([f, empty, feature('c')])).toEqual([['a', ['01-questions.md']]])
  })

  it('skips a feature outside its project folder', () => {
    const outside = feature('a', { path: '/elsewhere/a', artifacts: [md('x.md', null)] })
    expect(clusters([outside])).toEqual([])
  })

  it('orders clusters by stage, earliest first, then in the given order', () => {
    const late = feature('a', { currentStage: 'design', artifacts: [md('x.md', null)] })
    const early = feature('b', { currentStage: 'questions', artifacts: [md('x.md', null)] })
    const mid = feature('c', { currentStage: 'research', artifacts: [md('x.md', null)] })
    const union = unionFeatures([late, early, mid], repoGroups(projects))
    expect(artifactClusters(stages, union, projects).map((c) => c.feature.slug)).toEqual(['b', 'c', 'a'])
  })
})

describe('pageClusters, openCard', () => {
  const inWorktree = feature('w', { projectId: 'wt', path: '/src/wt/docs/work/w', artifacts: [md('x.md', null)] })
  const features = [feature('a', { artifacts: [md('x.md', null)] }), inWorktree]
  const ref = { projectId: 'wt', slug: 'w', name: 'x.md' }
  const ui = (over: Partial<UiState>): UiState => ({ ...DEFAULT_UI, ...over })

  it("takes the repo's features, one cluster per feature, pointing at the feature's own checkout", () => {
    const list = pageClusters(projects[0], projects, stages, features)
    expect(list.map((c) => [c.feature.projectId, c.feature.slug])).toEqual([['p', 'a'], ['wt', 'w']])
    expect(list[1].cards[0].path).toBe('docs/work/w/x.md')
  })

  it("takes each feature's cards from the copy whose files changed last, the checkout's on a tie", () => {
    const head = feature('a', { artifacts: [md('03-plan.md', null, 5)] })
    const ahead = feature('a', { projectId: 'wt', path: '/src/wt/docs/work/a', title: 'Ta in wt', artifacts: [md('03-plan.md', null, 9), md('04-run.md', null, 9)] })
    const [c] = pageClusters(projects[0], projects, stages, [head, ahead])
    expect([c.feature.projectId, c.feature.title, c.cards.map((k) => k.name)]).toEqual(['wt', 'Ta in wt', ['03-plan.md', '04-run.md']])
    expect(c.feature).toMatchObject({ headId: 'p', copies: [{ projectId: 'p' }, { projectId: 'wt' }] })
    const tied = feature('a', { projectId: 'wt', path: '/src/wt/docs/work/a', artifacts: [md('03-plan.md', null, 5)] })
    expect(pageClusters(projects[0], projects, stages, [head, tied])[0].feature.projectId).toBe('p')
  })

  it('resolves the focused artifact in the repo of its project, and nothing for a gone file or no focus', () => {
    expect(openCard(ui({ focusedArtifact: ref }), projects, stages, features)?.card.name).toBe('x.md')
    expect(openCard(ui({ focusedArtifact: { ...ref, projectId: 'p', slug: 'a' } }), projects, stages, features)?.card.name).toBe('x.md')
    expect(openCard(ui({ focusedArtifact: { ...ref, name: 'gone.md' } }), projects, stages, features)).toBeUndefined()
    expect(openCard(ui({ focusedArtifact: { ...ref, projectId: 'gone' } }), projects, stages, features)).toBeUndefined()
    expect(openCard(ui({}), projects, stages, features)).toBeUndefined()
  })
})

describe('findCard', () => {
  const list = clusters([feature('a', { artifacts: [md('x.md', null)] })])
  it('finds a card by slug and name, whichever copy the ref was made on, and nothing for a stale name', () => {
    expect(findCard(list, { projectId: 'p', slug: 'a', name: 'x.md' })?.card.path).toBe('docs/work/a/x.md')
    expect(findCard(list, { projectId: 'wt', slug: 'a', name: 'x.md' })?.card.path).toBe('docs/work/a/x.md')
    expect(findCard(list, { projectId: 'p', slug: 'b', name: 'x.md' })).toBeUndefined()
    expect(findCard(list, { projectId: 'p', slug: 'a', name: 'y.md' })).toBeUndefined()
  })
})

describe('artifactCrumbs', () => {
  it('reads project > feature > artifact, each up-link going where it says', () => {
    const f = feature('a')
    const card = { name: 'x.md', path: 'docs/work/a/x.md', stage: null, mtimeMs: 1, source: null }
    expect(artifactCrumbs(projects[0], f, card)).toEqual([
      { label: 'grove', to: { focusedProject: 'p' } },
      { label: 'Ta', to: { focusedFeature: { projectId: 'p', slug: 'a' } } },
      { label: 'x.md' },
    ])
  })
})

describe('neighbours', () => {
  const list = clusters([
    feature('a', { artifacts: [md('1.md', null), md('2.md', null)] }),
    feature('b', { artifacts: [md('3.md', null)] }),
    feature('c', { artifacts: [md('4.md', null), md('5.md', null)] }),
  ])
  const ref = (slug: string, name: string) => ({ projectId: 'p', slug, name })

  it('steps within a cluster', () => {
    expect(neighbours(list, ref('a', '1.md'))).toEqual({ prev: null, next: ref('a', '2.md'), index: 0, total: 5 })
    expect(neighbours(list, ref('c', '4.md')).next).toEqual(ref('c', '5.md'))
  })

  it('crosses cluster edges both ways', () => {
    expect(neighbours(list, ref('a', '2.md'))).toEqual({ prev: ref('a', '1.md'), next: ref('b', '3.md'), index: 1, total: 5 })
    expect(neighbours(list, ref('b', '3.md'))).toEqual({ prev: ref('a', '2.md'), next: ref('c', '4.md'), index: 2, total: 5 })
  })

  it('stops at the first and last cards', () => {
    expect(neighbours(list, ref('a', '1.md')).prev).toBeNull()
    expect(neighbours(list, ref('c', '5.md'))).toEqual({ prev: ref('c', '4.md'), next: null, index: 4, total: 5 })
  })

  it("walks one feature's cluster alone", () => {
    const only = list.filter((c) => c.feature.slug === 'c')
    expect(neighbours(only, ref('c', '4.md'))).toEqual({ prev: null, next: ref('c', '5.md'), index: 0, total: 2 })
    expect(neighbours(only, ref('c', '5.md'))).toEqual({ prev: ref('c', '4.md'), next: null, index: 1, total: 2 })
  })

  it('gives an unknown ref no neighbours', () => {
    expect(neighbours(list, ref('a', 'gone.md'))).toEqual({ prev: null, next: null, index: -1, total: 5 })
    expect(neighbours(list, { projectId: 'wt', slug: 'a', name: '1.md' }).index).toBe(-1)
  })
})

describe('stepKey', () => {
  const body = { tagName: 'BODY', isContentEditable: false } as unknown as EventTarget
  const key = (k: string, over: Partial<Parameters<typeof stepKey>[0]> = {}) =>
    stepKey({ key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: body, ...over })

  it('steps back on ArrowLeft and on ArrowRight', () => {
    expect(key('ArrowLeft')).toBe(-1)
    expect(key('ArrowRight')).toBe(1)
    expect(key('ArrowRight', { target: null })).toBe(1)
  })

  it('ignores an arrow with any modifier', () => {
    for (const m of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) expect(key('ArrowRight', { [m]: true })).toBeNull()
  })

  it('ignores an arrow typed into a field', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) expect(key('ArrowLeft', { target: { tagName, isContentEditable: false } as unknown as EventTarget })).toBeNull()
    expect(key('ArrowLeft', { target: { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget })).toBeNull()
  })

  it('ignores other keys', () => {
    for (const k of ['ArrowUp', 'ArrowDown', 'Enter', 'a', ' ']) expect(key(k)).toBeNull()
  })
})

describe('commentCard', () => {
  const f = { projectId: 'p', slug: 'a' }
  const cards = [
    { name: '01-questions.md', path: 'docs/work/a/01-questions.md', stage: null, mtimeMs: 1, source: null },
    { name: '03-design.md', path: 'docs/work/a/03-design.html', stage: null, mtimeMs: 2, source: { path: 'docs/work/a/03-design.md', mtimeMs: 1 } },
  ]

  it('finds the card that opens the file, or the one whose markdown it is', () => {
    expect(commentCard(cards, f, { projectId: 'p', path: 'docs/work/a/01-questions.md' })).toMatchObject({ ref: { projectId: 'p', slug: 'a', name: '01-questions.md' }, markdown: false })
    expect(commentCard(cards, f, { projectId: 'p', path: 'docs/work/a/03-design.md' })).toMatchObject({ ref: { projectId: 'p', slug: 'a', name: '03-design.md' }, markdown: true })
  })

  it('finds nothing for a file no card shows, or another checkout\'s', () => {
    expect(commentCard(cards, f, { projectId: 'p', path: 'CONTEXT.md' })).toBeNull()
    expect(commentCard(cards, f, { projectId: 'q', path: 'docs/work/a/01-questions.md' })).toBeNull()
  })
})
