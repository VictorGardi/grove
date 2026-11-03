import { isViewable } from '@shared/artifactUrl'
import type { ArtifactRef, Feature, FeatureKey, Project, UiState } from '@shared/types'
import { unionFeatures, type UnionFeature } from './featureUnion'
import type { Crumb } from './navigation'
import { repoGroups, repoProjectIds } from './repoGroups'
import { featureDir } from './viewerFiles'

export interface ArtifactCard {
  name: string          // what the card says, and what an ArtifactRef names
  path: string          // project-relative path the card opens: the html companion when there is one
  stage: string | null
  mtimeMs: number       // of the file it opens, so the full page reloads when that changes
  source: { path: string; mtimeMs: number } | null // the markdown behind an html companion, to comment on; null otherwise
}
export interface ArtifactCluster<T extends Feature = UnionFeature> { feature: T; cards: ArtifactCard[] }

const stem = (name: string) => name.replace(/\.[^./]+$/, '')
const isMd = (name: string) => /\.md$/i.test(name)

// One feature's cards. An html review is the rendered face of its markdown, so the two are one
// card that opens the html under the markdown's name; an html with no markdown stands alone.
function cardsOf(f: Feature, dir: string, stages: { id: string }[]): ArtifactCard[] {
  const files = f.artifacts.filter((a) => isViewable(a.name))
  const companion = (md: string) => files.find((a) => a.role === 'review' && !isMd(a.name) && stem(a.name) === stem(md))
  const folded = new Set(files.filter((a) => isMd(a.name)).flatMap((a) => companion(a.name)?.name ?? []))
  const rank = (stage: string | null) => { const i = stages.findIndex((s) => s.id === stage); return i < 0 ? stages.length : i }
  return files.filter((a) => !folded.has(a.name)).map((a) => {
    const open = isMd(a.name) ? companion(a.name) ?? a : a
    const source = open === a ? null : { path: dir + a.name, mtimeMs: a.mtimeMs }
    return { name: a.name, path: dir + open.name, stage: a.stage, mtimeMs: open.mtimeMs, source }
  }).sort((a, b) => rank(a.stage) - rank(b.stage) || a.name.localeCompare(b.name))
}

// Every feature's cards, clustered by workflow stage (earliest first; a done feature sits at the last
// stage of its own flow), then in the given order. Group features have no cards of their own.
export function artifactClusters<T extends Feature>(stages: { id: string; label: string }[], features: T[], projects: Project[]): ArtifactCluster<T>[] {
  const shown = features.filter((f) => !f.group)
  const used = stages.filter((s) => shown.some((f) => f.stages.some((fs) => fs.id === s.id)))
  const last = used[used.length - 1]?.id
  const column = (f: T) => { const i = used.findIndex((s) => s.id === (f.currentStage ?? f.stages[f.stages.length - 1]?.id ?? last)); return i < 0 ? used.length : i }
  const ordered = shown.map((feature, i) => ({ feature, i, c: column(feature) })).sort((a, b) => a.c - b.c || a.i - b.i)
  return ordered.flatMap(({ feature }) => {
    const dir = featureDir(feature, projects)
    const cards = dir === null ? [] : cardsOf(feature, dir, stages)
    return cards.length > 0 ? [{ feature, cards }] : []
  })
}

// When its viewable files last changed in one checkout's copy; 0 with none.
const touchedAt = (f: Feature) => Math.max(0, ...f.artifacts.filter((a) => isViewable(a.name)).map((a) => a.mtimeMs))

// A feature's cards come from the copy whose files changed last, not always the checkout's: while a
// run works in a worktree, its artifacts are ahead of the plan the checkout holds. A tie keeps the checkout's.
function newestCopy(f: UnionFeature): UnionFeature {
  const best = f.copies.reduce<Feature>((b, c) => (touchedAt(c.feature) > touchedAt(b) ? c.feature : b), f)
  return best === f || best.projectId === f.projectId ? f : { ...best, flags: f.flags, headId: f.headId, copies: f.copies }
}

// A checkout page's clusters: the repo's features, unioned (one per slug), each from its newest copy.
export function pageClusters(project: Project, projects: Project[], stages: { id: string; label: string }[], features: Feature[]): ArtifactCluster[] {
  const scope = repoProjectIds(projects, project.id)
  const union = unionFeatures(features.filter((f) => scope.has(f.projectId)), repoGroups(projects))
  return artifactClusters(stages, union.map(newestCopy), projects)
}

// By slug: a page's clusters are one repo's, one per slug, and the copy behind a cluster can change
// under an open ref as another checkout's files move ahead.
export function findCard<T extends Feature>(clusters: ArtifactCluster<T>[], ref: ArtifactRef): { cluster: ArtifactCluster<T>; card: ArtifactCard } | undefined {
  const cluster = clusters.find((c) => c.feature.slug === ref.slug)
  const card = cluster?.cards.find((c) => c.name === ref.name)
  return cluster && card ? { cluster, card } : undefined
}

// The artifact the content area shows, if it shows one: the focused ref's card, in the repo of the
// project it names. A file gone resolves to nothing and the page falls back to the project's.
export function openCard(ui: Pick<UiState, 'focusedArtifact'>, projects: Project[], stages: { id: string; label: string }[], features: Feature[]) {
  const ref = ui.focusedArtifact
  const project = ref && projects.find((p) => p.id === ref.projectId)
  return project && ref ? findCard(pageClusters(project, projects, stages, features), ref) : undefined
}

const refOf = (c: ArtifactCluster<Feature>, card: ArtifactCard): ArtifactRef => ({ projectId: c.feature.projectId, slug: c.feature.slug, name: card.name })

// The full page's previous and next artifacts: clusters in order, cards in order, across cluster
// edges (the page passes its own feature's cluster alone). An unknown ref has neither, at index -1.
export function neighbours(clusters: ArtifactCluster<Feature>[], ref: ArtifactRef): { prev: ArtifactRef | null; next: ArtifactRef | null; index: number; total: number } {
  const all = clusters.flatMap((c) => c.cards.map((card) => refOf(c, card)))
  const index = all.findIndex((r) => r.projectId === ref.projectId && r.slug === ref.slug && r.name === ref.name)
  if (index < 0) return { prev: null, next: null, index, total: all.length }
  return { prev: all[index - 1] ?? null, next: all[index + 1] ?? null, index, total: all.length }
}

// Where a feature's file comment lives on the full page: the card that opens its file, or the card
// whose markdown it is (then shown as markdown). None for a file no card of the feature shows.
export function commentCard(cards: ArtifactCard[], feature: FeatureKey, at: { projectId: string; path: string }): { ref: ArtifactRef; card: ArtifactCard; markdown: boolean } | null {
  if (at.projectId !== feature.projectId) return null
  const card = cards.find((c) => c.path === at.path) ?? cards.find((c) => c.source?.path === at.path)
  return card ? { ref: { projectId: feature.projectId, slug: feature.slug, name: card.name }, card, markdown: card.path !== at.path } : null
}

// The step an arrow key asks for on the full page: none with a modifier (the system's own
// shortcuts), or while typing in a field.
export function stepKey(e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; target: EventTarget | null }): -1 | 1 | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null
  if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName?.toUpperCase() ?? '') || t.isContentEditable)) return null
  return e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : null
}


// project > feature > artifact; the feature up-link closes the full page back to the feature's page.
export function artifactCrumbs(project: Project, feature: Feature, card: ArtifactCard): Crumb[] {
  return [
    { label: project.name, to: { focusedProject: project.id } },
    { label: feature.title, to: { focusedFeature: { projectId: feature.projectId, slug: feature.slug } } },
    { label: card.name },
  ]
}
