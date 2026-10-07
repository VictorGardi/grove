import type { Feature, Project, Session, UiState } from '@shared/types'
import { gridShown } from './gridView'
import { sessionGroups, sessionOrder } from './tree'

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

// The project page ⌘B opens: the current context's project, else the first project.
export function boardProject(ui: UiState, projects: Project[], sessions: Session[], features: Feature[]): string | null {
  const c = content(ui, projects, sessions, features)
  if (c.kind === 'session') return c.session.projectId
  if (c.kind === 'grid') return c.focused.projectId
  if (c.kind === 'feature') return c.feature.projectId
  if (c.kind === 'project') return c.project.id
  return null
}

const bySlugDoneLast = (a: Feature, b: Feature) =>
  Number(a.cardState === 'done') - Number(b.cardState === 'done') || a.slug.localeCompare(b.slug)

// A feature's children: same project, `parent` naming it (generic group kinds, ADR 0002).
export function childrenOf(feature: Feature, features: Feature[]): Feature[] {
  return features.filter((f) => f.projectId === feature.projectId && f.parent === feature.slug).sort(bySlugDoneLast)
}

// ⌘B: on a project page switch its board, elsewhere open the context project's page.
export function boardKey(ui: UiState, projects: Project[], sessions: Session[], features: Feature[]): Partial<UiState> | null {
  if (content(ui, projects, sessions, features).kind === 'project') return { board: ui.board === 'features' ? 'sessions' : 'features' }
  const id = boardProject(ui, projects, sessions, features)
  return id ? openBoard(id) : null
}

// Cmd+1..9: pane n while the grid shows, else the nth session in sidebar order.
export function focusTarget(ui: UiState, projects: Project[], sessions: Session[], features: Feature[], n: number): Session | undefined {
  const c = content(ui, projects, sessions, features)
  return c.kind === 'grid' ? c.sessions[n - 1] : sessionOrder(sessionGroups(projects, sessions, ui))[n - 1]
}
