import { describe, expect, it } from 'vitest'
import { DEFAULT_UI, type Feature, type Project, type UiState } from '@shared/types'
import { artifactClusters, artifactCrumbs, artifactsTo, findCard, openCard, pageClusters } from './artifactsBoard'
import { unionFeatures } from './featureUnion'
import { repoGroups } from './repoGroups'
import { boardColumns } from './tree'

const projects: Project[] = [
  { id: 'p', name: 'grove', path: '/src/p' },
  { id: 'wt', name: 'grove · fix-auth', path: '/src/wt', worktreeOf: 'p' },
]
const stages = [{ id: 'questions', label: 'Questions' }, { id: 'research', label: 'Research' }, { id: 'design', label: 'Design' }]

type A = Feature['artifacts'][number]
const md = (name: string, stage: string | null, mtimeMs = 1): A => ({ name, stage, role: 'artifact', mtimeMs })
const html = (name: string, stage: string | null, mtimeMs = 2): A => ({ name, stage, role: 'review', mtimeMs })

const feature = (slug: string, over: Partial<Feature> = {}): Feature => ({
  projectId: 'p', slug, path: '/src/p/docs/work/' + slug, title: 'T' + slug, kind: 'feature', group: false,
  parent: null, flow: null, stages: stages.map((st) => ({ ...st, artifact: st.id + '.md', review: null, state: 'upcoming' as const })),
  currentStage: 'questions', cardState: 'ready', progress: null, flags: [], warnings: [], artifacts: [], ...over,
})

const clusters = (features: Feature[]) => artifactClusters(stages, features, projects)
const names = (features: Feature[]) => clusters(features).map((c) => [c.feature.slug, c.cards.map((k) => k.name)])

describe('artifactClusters', () => {
  it('groups cards by feature, in stage order then name, unknown stages last', () => {
    const f = feature('a', { artifacts: [md('notes.md', null), md('03-design.md', 'design'), md('01-questions.md', 'questions'), md('00-ticket.md', 'questions')] })
    expect(names([f])).toEqual([['a', ['00-ticket.md', '01-questions.md', '03-design.md', 'notes.md']]])
  })

  it('folds an html review into its markdown: the card keeps the name and opens the html', () => {
    const f = feature('a', { artifacts: [md('02-research.md', 'research', 5), html('02-research.html', 'research', 9)] })
    expect(clusters([f])[0].cards).toEqual([{ name: '02-research.md', path: 'docs/work/a/02-research.html', stage: 'research', mtimeMs: 9 }])
  })

  it('opens the markdown itself when it has no html, and keeps an html with no markdown as its own card', () => {
    const f = feature('a', { artifacts: [md('01-questions.md', 'questions'), html('mockup.html', 'design')] })
    expect(clusters([f])[0].cards.map((c) => [c.name, c.path])).toEqual([
      ['01-questions.md', 'docs/work/a/01-questions.md'],
      ['mockup.html', 'docs/work/a/mockup.html'],
    ])
  })

  it('gives non-viewable files no card, and a feature without cards no cluster', () => {
    const f = feature('a', { artifacts: [md('01-questions.md', 'questions'), { name: 'data.json', stage: null, role: null, mtimeMs: 1 }] })
    const empty = feature('b', { artifacts: [{ name: 'run.log', stage: null, role: null, mtimeMs: 1 }] })
    expect(names([f, empty, feature('c')])).toEqual([['a', ['01-questions.md']]])
  })

  it('skips a feature outside its project folder, and group features like the board does', () => {
    const outside = feature('a', { path: '/elsewhere/a', artifacts: [md('x.md', null)] })
    const group = feature('g', { group: true, artifacts: [md('x.md', null)] })
    expect(clusters([outside, group])).toEqual([])
  })

  it('orders clusters like the features board, column by column', () => {
    const late = feature('a', { currentStage: 'design', artifacts: [md('x.md', null)] })
    const early = feature('b', { currentStage: 'questions', artifacts: [md('x.md', null)] })
    const mid = feature('c', { currentStage: 'research', artifacts: [md('x.md', null)] })
    const union = unionFeatures([late, early, mid], repoGroups(projects))
    const board = boardColumns(stages, union).flatMap((c) => c.cards.map((k) => k.feature.slug))
    expect(artifactClusters(stages, union, projects).map((c) => c.feature.slug)).toEqual(board)
    expect(board).toEqual(['b', 'c', 'a'])
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

  it('resolves the open artifact only on a checkout page showing the artifacts board', () => {
    const open = ui({ board: 'artifacts', artifacts: { p: { open: ref } } })
    expect(openCard(open, projects[0], projects, stages, features)?.card.name).toBe('x.md')
    expect(openCard({ ...open, board: 'features' }, projects[0], projects, stages, features)).toBeUndefined()
    expect(openCard(ui({ board: 'artifacts', artifacts: { wt: { open: ref } } }), projects[1], projects, stages, features)).toBeUndefined()
    expect(openCard(ui({ board: 'artifacts', artifacts: { p: { open: { ...ref, name: 'gone.md' } } } }), projects[0], projects, stages, features)).toBeUndefined()
  })
})

describe('findCard', () => {
  const list = clusters([feature('a', { artifacts: [md('x.md', null)] })])
  it('finds a card by feature and name, and nothing for a stale ref', () => {
    expect(findCard(list, { projectId: 'p', slug: 'a', name: 'x.md' })?.card.path).toBe('docs/work/a/x.md')
    expect(findCard(list, { projectId: 'wt', slug: 'a', name: 'x.md' })).toBeUndefined()
    expect(findCard(list, { projectId: 'p', slug: 'a', name: 'y.md' })).toBeUndefined()
  })
})

describe('artifactsTo, artifactCrumbs', () => {
  const ref = { projectId: 'p', slug: 'a', name: 'x.md' }
  const ui: UiState = { ...DEFAULT_UI, artifacts: { q: { open: null } } }

  it("sets one page's open artifact and leaves the others", () => {
    expect(artifactsTo(ui, 'p', ref)).toEqual({ artifacts: { q: { open: null }, p: { open: ref } } })
    expect(artifactsTo(DEFAULT_UI, 'p', null)).toEqual({ artifacts: { p: { open: null } } })
  })

  it('reads project > Artifacts > feature > artifact, each up-link going where it says', () => {
    const f = feature('a')
    const card = { name: 'x.md', path: 'docs/work/a/x.md', stage: null, mtimeMs: 1 }
    expect(artifactCrumbs(projects[0], f, card, ui)).toEqual([
      { label: 'grove', to: { focusedProject: 'p', board: 'sessions' } },
      { label: 'Artifacts', to: { artifacts: { q: { open: null }, p: { open: null } } } },
      { label: 'Ta', to: { focusedFeature: { projectId: 'p', slug: 'a' } } },
      { label: 'x.md' },
    ])
  })
})
