import { IMAGE_EXTS, artifactUrl, extOf, isViewable } from '@shared/artifactUrl'
import type { ArtifactRef, CanvasView, Feature, FeatureKey, Project, UiState } from '@shared/types'
import { unionFeatures, type UnionFeature } from './featureUnion'
import { openBoard, type Crumb } from './navigation'
import { repoGroups, repoProjectIds } from './repoGroups'
import { boardColumns } from './tree'
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

// Every feature's cards, clustered in the features board's order (its columns read left to right)
// so the board, and later the step-through, walk features the way the human already sees them.
export function artifactClusters<T extends Feature>(stages: { id: string; label: string }[], features: T[], projects: Project[]): ArtifactCluster<T>[] {
  return boardColumns(stages, features).flatMap((c) => c.cards).flatMap(({ feature }) => {
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

// A checkout page's clusters: the repo's features, unioned like the features board's, each from its newest copy.
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

// The artifact a project page shows full page, if it shows one: a checkout's, on the artifacts
// board, whose open ref still resolves to a card (a file gone stays on the board).
export function openCard(ui: Pick<UiState, 'board' | 'artifacts'>, project: Project, projects: Project[], stages: { id: string; label: string }[], features: Feature[]) {
  const ref = ui.artifacts?.[project.id]?.open
  if (project.worktreeOf || ui.board !== 'artifacts' || !ref) return undefined
  return findCard(pageClusters(project, projects, stages, features), ref)
}

export const artifactsTo = (ui: UiState, projectId: string, open: ArtifactRef | null): Partial<UiState> =>
  ({ artifacts: { ...ui.artifacts, [projectId]: { ...ui.artifacts?.[projectId], open } } })

// The board's saved pan and zoom on one page; the page's open artifact and filter stay as they are.
export const boardViewTo = (ui: UiState, projectId: string, view: CanvasView): Partial<UiState> =>
  ({ artifacts: { ...ui.artifacts, [projectId]: { ...ui.artifacts?.[projectId], open: ui.artifacts?.[projectId]?.open ?? null, view } } })

// The one feature the board shows on one page (null: all), and the view it starts at if given, in one
// write: two would each echo the whole ui back and briefly undo the other. The open artifact stays.
export const filterTo = (ui: UiState, projectId: string, filter: string | null, view?: CanvasView): Partial<UiState> =>
  ({ artifacts: { ...ui.artifacts, [projectId]: { ...ui.artifacts?.[projectId], open: ui.artifacts?.[projectId]?.open ?? null, filter, ...(view && { view }) } } })

// The clusters the board draws: the filtered feature's alone. A filter naming no cluster (its feature
// gone, or its last file) is stale, and shows all rather than an empty board.
export function filterClusters<T extends Feature>(clusters: ArtifactCluster<T>[], filter: string | null | undefined): ArtifactCluster<T>[] {
  const hit = filter ? clusters.filter((c) => c.feature.slug === filter) : []
  return hit.length > 0 ? hit : clusters
}

const refOf = (c: ArtifactCluster<Feature>, card: ArtifactCard): ArtifactRef => ({ projectId: c.feature.projectId, slug: c.feature.slug, name: card.name })

// The full page's previous and next artifacts, in board order: clusters in order, cards in order,
// across cluster edges. An unknown ref has neither, at index -1.
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

// project > Artifacts > feature > artifact; "Artifacts" closes the full page back to the board.
export function artifactCrumbs(project: Project, feature: Feature, card: ArtifactCard, ui: UiState): Crumb[] {
  return [
    { label: project.name, to: openBoard(project.id) },
    { label: 'Artifacts', to: artifactsTo(ui, project.id, null) },
    { label: feature.title, to: { focusedFeature: { projectId: feature.projectId, slug: feature.slug } } },
    { label: card.name },
  ]
}

// A card's preview: images draw as an <img>, everything else (html, markdown rendered by the protocol) as a page.
export function previewKind(path: string): 'image' | 'page' {
  const ext = extOf(path)
  return ext !== undefined && IMAGE_EXTS.includes(ext) ? 'image' : 'page'
}

// The preview's source. Chromium reuses a loaded image with the same URL, so an image's carries the
// mtime (the protocol reads only the path); a page keeps the plain URL and reloads by remounting.
export function previewSrc(projectId: string, card: ArtifactCard): string {
  const url = artifactUrl({ kind: 'file', projectId, path: card.path, hash: null, fromDiff: null })
  return previewKind(card.path) === 'image' ? `${url}?v=${card.mtimeMs}` : url
}

// "5m ago" on a card, a short date ("12 Oct") once it is a week old.
export function modifiedAgo(mtimeMs: number, now: number): string {
  const min = Math.floor((now - mtimeMs) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(mtimeMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
