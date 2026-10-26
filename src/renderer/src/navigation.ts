import type { Feature, Project, Session, UiState } from '@shared/types'
import { DEFAULT_GRID_VIEW, gridShown, visibleMembers, type GridView } from './gridView'
import { listGroups, orderedSessions } from './sessionList'
import { repoHead } from './repoGroups'

// What the content area shows (ADR 0018): one of three exclusive focuses, else the first project's page.
// The session grid (ADR 0031) takes over while it shows; its focused pane is the focused session.
export type Content =
  | { kind: 'grid'; sessions: Session[]; focused: Session }
  | { kind: 'project'; project: Project }
  | { kind: 'feature'; feature: Feature }
  | { kind: 'session'; session: Session }
  | { kind: 'none' }

// The project the human is in: the session's, the feature's, or the project page's.
export const currentProjectId = (c: Content): string | null =>
  c.kind === 'project' ? c.project.id : c.kind === 'feature' ? c.feature.projectId
    : c.kind === 'session' ? c.session.projectId : c.kind === 'grid' ? c.focused.projectId : null

export interface Crumb { label: string; to?: Partial<UiState> } // `to`: the ui:set partial an up-link applies

const findFeature = (features: Feature[], projectId: string, slug: string | null) =>
  slug === null ? undefined : features.find((f) => f.projectId === projectId && f.slug === slug)

export function content(ui: UiState, projects: Project[], sessions: Session[], features: Feature[]): Content {
  if (gridShown(ui)) {
    const members = ui.grid.members.flatMap((id) => sessions.find((s) => s.id === id) ?? []) // gone ids are skipped
    const focused = members.find((s) => s.id === ui.focusedSessionId)
    if (focused) return { kind: 'grid', sessions: members, focused }
  }
  const session = ui.focusedSessionId && sessions.find((s) => s.id === ui.focusedSessionId)
  if (session) return { kind: 'session', session }
  const ff = ui.focusedFeature
  const feature = ff && findFeature(features, ff.projectId, ff.slug)
  if (feature) return { kind: 'feature', feature }
  const project = projects.find((p) => p.id === (ui.focusedProject ?? ff?.projectId)) ?? projects[0]
  return project ? { kind: 'project', project } : { kind: 'none' }
}

// Going to a project page always lands on its Sessions board (ADR 0020); the switch still flips it there.
export const openBoard = (id: string): Partial<UiState> => ({ focusedProject: id, board: 'sessions' })

const projectCrumb = (projects: Project[], id: string): Crumb =>
  ({ label: projects.find((p) => p.id === id)?.name ?? id, to: openBoard(id) })
const featureCrumb = (f: Feature): Crumb => ({ label: f.title, to: { focusedFeature: { projectId: f.projectId, slug: f.slug } } })

// Breadcrumb up-links; the last crumb is the current page and has no `to`.
export function crumbs(c: Content, projects: Project[], features: Feature[]): Crumb[] {
  if (c.kind === 'none') return []
  if (c.kind === 'grid') return [{ label: 'Session grid' }]
  if (c.kind === 'project') return [{ label: c.project.name }]
  if (c.kind === 'feature') {
    const f = c.feature
    const parent = findFeature(features, f.projectId, f.parent)
    return [projectCrumb(projects, f.projectId), ...(parent ? [featureCrumb(parent)] : []), { label: f.title }]
  }
  const s = c.session
  const linked = findFeature(features, s.projectId, s.feature)
  return [projectCrumb(projects, s.projectId), ...(linked ? [featureCrumb(linked)] : []), { label: s.label }]
}

// The project page ⌘B opens: the current context's project, else the first project. A worktree
// resolves to the checkout it hangs under, because the features board is the repo's (design D3).
export function boardProject(ui: UiState, projects: Project[], sessions: Session[], features: Feature[]): string | null {
  const c = content(ui, projects, sessions, features)
  if (c.kind === 'session') return repoHead(projects, c.session.projectId)
  if (c.kind === 'grid') return repoHead(projects, c.focused.projectId)
  if (c.kind === 'feature') return repoHead(projects, c.feature.projectId)
  if (c.kind === 'project') return repoHead(projects, c.project.id)
  return null
}

const bySlugDoneLast = (a: Feature, b: Feature) =>
  Number(a.cardState === 'done') - Number(b.cardState === 'done') || a.slug.localeCompare(b.slug)

// A feature's children: same project, `parent` naming it (generic group kinds, ADR 0002).
export function childrenOf(feature: Feature, features: Feature[]): Feature[] {
  return features.filter((f) => f.projectId === feature.projectId && f.parent === feature.slug).sort(bySlugDoneLast)
}

// ⌘B: on a checkout's page flip features and sessions (artifacts goes to features), elsewhere open the
// context project's page. A worktree's page has only the sessions board, so ⌘B there goes to the repo's page.
export function boardKey(ui: UiState, projects: Project[], sessions: Session[], features: Feature[]): Partial<UiState> | null {
  const c = content(ui, projects, sessions, features)
  if (c.kind === 'project' && repoHead(projects, c.project.id) === c.project.id) return { board: ui.board === 'features' ? 'sessions' : 'features' }
  const id = boardProject(ui, projects, sessions, features)
  return id ? openBoard(id) : null
}

// ⌘⇧A: the context's repo page on its artifacts board, filtered to the feature the human came from
// (a session's link, a feature page's own); unlinked, all features. On the board itself, the filter
// stays and an open artifact closes. A new filter drops the saved view, so the board starts at its top-left.
export function artifactsKey(ui: UiState, projects: Project[], sessions: Session[], features: Feature[]): Partial<UiState> | null {
  const c = content(ui, projects, sessions, features)
  const id = boardProject(ui, projects, sessions, features)
  if (!id) return null
  const cur = ui.artifacts?.[id]
  const slug = c.kind === 'session' ? c.session.feature ?? null : c.kind === 'grid' ? c.focused.feature ?? null
    : c.kind === 'feature' ? c.feature.slug : cur?.filter ?? null
  const next = slug === (cur?.filter ?? null) ? { ...cur, open: null } : { open: null, filter: slug }
  return { focusedProject: id, board: 'artifacts', artifacts: { ...ui.artifacts, [id]: next } }
}

// Cmd+1..9: visible pane n while the grid shows, else the nth session in sidebar order.
export function focusTarget(ui: UiState, projects: Project[], sessions: Session[], features: Feature[], n: number, view: GridView = DEFAULT_GRID_VIEW): Session | undefined {
  const c = content(ui, projects, sessions, features)
  return c.kind === 'grid' ? visibleMembers(c.sessions, view, projects)[n - 1] : orderedSessions(listGroups(projects, sessions, ui))[n - 1]
}
