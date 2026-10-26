import { describe, expect, it } from 'vitest'
import { DEFAULT_UI, type Feature, type Project, type UiState } from '@shared/types'
import { artifactClusters, artifactCrumbs, commentCard, artifactsTo, boardViewTo, filterClusters, filterTo, findCard, modifiedAgo, neighbours, openCard, pageClusters, previewKind, previewSrc, stepKey } from './artifactsBoard'
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

  it("keeps a page's saved view when its open artifact changes, and its open artifact when its view does", () => {
    const view = { x: 10, y: -20, scale: 0.5 }
    const withView: UiState = { ...ui, artifacts: { ...ui.artifacts, p: { open: null, view } } }
    expect(artifactsTo(withView, 'p', ref)).toEqual({ artifacts: { q: { open: null }, p: { open: ref, view } } })
    const opened: UiState = { ...ui, artifacts: { ...ui.artifacts, p: { open: ref } } }
    expect(boardViewTo(opened, 'p', view)).toEqual({ artifacts: { q: { open: null }, p: { open: ref, view } } })
    expect(boardViewTo(DEFAULT_UI, 'p', view)).toEqual({ artifacts: { p: { open: null, view } } })
  })

  it("keeps a page's filter when its open artifact or view changes, and both when its filter does, unless a view comes with it", () => {
    const view = { x: 10, y: -20, scale: 0.5 }
    const full: UiState = { ...ui, artifacts: { ...ui.artifacts, p: { open: ref, view, filter: 'a' } } }
    expect(artifactsTo(full, 'p', null)).toEqual({ artifacts: { q: { open: null }, p: { open: null, view, filter: 'a' } } })
    expect(boardViewTo(full, 'p', { x: 0, y: 0, scale: 1 })).toEqual({ artifacts: { q: { open: null }, p: { open: ref, view: { x: 0, y: 0, scale: 1 }, filter: 'a' } } })
    expect(filterTo(full, 'p', 'b')).toEqual({ artifacts: { q: { open: null }, p: { open: ref, view, filter: 'b' } } })
    expect(filterTo(full, 'p', null)).toEqual({ artifacts: { q: { open: null }, p: { open: ref, view, filter: null } } })
    expect(filterTo(DEFAULT_UI, 'p', 'a')).toEqual({ artifacts: { p: { open: null, filter: 'a' } } })
    // with a view, the filter and the view it starts at land in one write; the open artifact and other pages stay
    const start = { x: 0, y: 0, scale: 0.5 }
    expect(filterTo(full, 'p', 'b', start)).toEqual({ artifacts: { q: { open: null }, p: { open: ref, view: start, filter: 'b' } } })
    expect(filterTo(DEFAULT_UI, 'p', null, start)).toEqual({ artifacts: { p: { open: null, view: start, filter: null } } })
  })

  it('reads project > Artifacts > feature > artifact, each up-link going where it says', () => {
    const f = feature('a')
    const card = { name: 'x.md', path: 'docs/work/a/x.md', stage: null, mtimeMs: 1, source: null }
    expect(artifactCrumbs(projects[0], f, card, ui)).toEqual([
      { label: 'grove', to: { focusedProject: 'p', board: 'sessions' } },
      { label: 'Artifacts', to: { artifacts: { q: { open: null }, p: { open: null } } } },
      { label: 'Ta', to: { focusedFeature: { projectId: 'p', slug: 'a' } } },
      { label: 'x.md' },
    ])
  })
})

describe('filterClusters', () => {
  const list = clusters([feature('a', { artifacts: [md('x.md', null)] }), feature('b', { artifacts: [md('y.md', null)] })])
  const slugs = (filter: string | null | undefined) => filterClusters(list, filter).map((c) => c.feature.slug)

  it('shows the filtered feature alone, and all without a filter or with a stale one', () => {
    expect(slugs('b')).toEqual(['b'])
    expect(slugs(null)).toEqual(['a', 'b'])
    expect(slugs(undefined)).toEqual(['a', 'b'])
    expect(slugs('gone')).toEqual(['a', 'b'])
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

  it("walks the filtered feature's cards only", () => {
    const only = filterClusters(list, 'c')
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

describe('previewKind', () => {
  it('draws images as images and everything else as a page', () => {
    expect(['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'd/a.svg'].map(previewKind)).toEqual(Array(6).fill('image'))
    expect(['a.html', 'a.htm', 'a.md', 'png.md'].map(previewKind)).toEqual(Array(4).fill('page'))
  })
})

describe('previewSrc', () => {
  const card = (path: string, mtimeMs: number) => ({ name: path, path, stage: null, mtimeMs, source: null })

  it('busts an image by its mtime, so a changed file is fetched again', () => {
    expect(previewSrc('p1', card('d/a b.png', 5))).toBe('grove-artifact://p1/d/a%20b.png?v=5')
    expect(previewSrc('p1', card('d/a b.png', 6))).not.toBe(previewSrc('p1', card('d/a b.png', 5)))
  })

  it('gives a page the plain URL', () => {
    expect(previewSrc('p1', card('d/03-design.html', 5))).toBe('grove-artifact://p1/d/03-design.html')
    expect(previewSrc('p1', card('d/03-design.html', 6))).toBe('grove-artifact://p1/d/03-design.html')
  })
})

describe('modifiedAgo', () => {
  const now = new Date(2026, 9, 26, 12, 0).getTime()
  const ago = (ms: number) => modifiedAgo(now - ms, now)
  const MIN = 60_000

  it('reads minutes, hours and days, then a short date', () => {
    expect(ago(30_000)).toBe('just now')
    expect(ago(-5 * MIN)).toBe('just now') // a clock ahead of ours
    expect(ago(5 * MIN)).toBe('5m ago')
    expect(ago(59 * MIN)).toBe('59m ago')
    expect(ago(60 * MIN)).toBe('1h ago')
    expect(ago(3 * 60 * MIN + 59 * MIN)).toBe('3h ago')
    expect(ago(24 * 60 * MIN)).toBe('1d ago')
    expect(ago(6 * 24 * 60 * MIN)).toBe('6d ago')
    expect(modifiedAgo(new Date(2026, 9, 12, 9, 0).getTime(), now)).toBe('12 Oct')
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
