import { IMAGE_EXTS, artifactUrl, extOf, isViewable } from '@shared/artifactUrl'
import type { ArtifactRef, CanvasView, Feature, Project, UiState } from '@shared/types'
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
    return { name: a.name, path: dir + open.name, stage: a.stage, mtimeMs: open.mtimeMs }
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

// A checkout page's clusters: the repo's features, unioned like the features board's.
export function pageClusters(project: Project, projects: Project[], stages: { id: string; label: string }[], features: Feature[]): ArtifactCluster[] {
  const scope = repoProjectIds(projects, project.id)
  return artifactClusters(stages, unionFeatures(features.filter((f) => scope.has(f.projectId)), repoGroups(projects)), projects)
}

export function findCard<T extends Feature>(clusters: ArtifactCluster<T>[], ref: ArtifactRef): { cluster: ArtifactCluster<T>; card: ArtifactCard } | undefined {
  const cluster = clusters.find((c) => c.feature.projectId === ref.projectId && c.feature.slug === ref.slug)
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

// The board's saved pan and zoom on one page; the page's open artifact stays as it is.
export const boardViewTo = (ui: UiState, projectId: string, view: CanvasView): Partial<UiState> =>
  ({ artifacts: { ...ui.artifacts, [projectId]: { open: ui.artifacts?.[projectId]?.open ?? null, view } } })

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
