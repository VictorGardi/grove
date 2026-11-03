import type { Feature, Project, Session, UiState } from '@shared/types'
import { DEFAULT_GRID_VIEW, gridShown, visibleMembers, type GridView } from './gridView'
import { listGroups, orderedSessions } from './sessionList'
import { repoHead } from './repoGroups'
import { artifactCrumbs, openCard, type ArtifactCard, type ArtifactCluster } from './artifactData'

// What the content area shows (ADR 0018): one of four exclusive focuses, else the first project's page.
// The session grid (ADR 0031) takes over while it shows; its focused pane is the focused session.
export type Content =
  | { kind: 'grid'; sessions: Session[]; focused: Session }
  | { kind: 'project'; project: Project }
  | { kind: 'feature'; feature: Feature }
  | { kind: 'artifact'; project: Project; cluster: ArtifactCluster; card: ArtifactCard } // cluster: the feature and all its cards, the page steps through them
  | { kind: 'session'; session: Session }
  | { kind: 'none' }

// The project the human is in: the session's, the feature's, or the project page's.
export const currentProjectId = (c: Content): string | null =>
  c.kind === 'project' ? c.project.id : c.kind === 'feature' ? c.feature.projectId
    : c.kind === 'artifact' ? c.project.id : c.kind === 'session' ? c.session.projectId : c.kind === 'grid' ? c.focused.projectId : null

export interface Crumb { label: string; to?: Partial<UiState> } // `to`: the ui:set partial an up-link applies

const findFeature = (features: Feature[], projectId: string, slug: string | null) =>
  slug === null ? undefined : features.find((f) => f.projectId === projectId && f.slug === slug)

export function content(ui: UiState, projects: Project[], sessions: Session[], features: Feature[], stages: { id: string; label: string }[] = []): Content {
  if (gridShown(ui)) {
    const members = ui.grid.members.flatMap((id) => sessions.find((s) => s.id === id) ?? []) // gone ids are skipped
    const focused = members.find((s) => s.id === ui.focusedSessionId)
    if (focused) return { kind: 'grid', sessions: members, focused }
  }
  const session = ui.focusedSessionId && sessions.find((s) => s.id === ui.focusedSessionId)
  if (session) return { kind: 'session', session }
  const art = openCard(ui, projects, stages, features)
  if (art) return { kind: 'artifact', project: projects.find((p) => p.id === ui.focusedArtifact?.projectId)!, cluster: art.cluster, card: art.card }
  const ff = ui.focusedFeature
  const feature = ff && findFeature(features, ff.projectId, ff.slug)
  if (feature) return { kind: 'feature', feature }
  const project = projects.find((p) => p.id === (ui.focusedProject ?? ff?.projectId)) ?? projects[0]
  return project ? { kind: 'project', project } : { kind: 'none' }
}

export const openProject = (id: string): Partial<UiState> => ({ focusedProject: id })

const projectCrumb = (projects: Project[], id: string): Crumb =>
  ({ label: projects.find((p) => p.id === id)?.name ?? id, to: openProject(id) })

// Breadcrumb up-links; the last crumb is the current page and has no `to`.
export function crumbs(c: Content, projects: Project[]): Crumb[] {
  if (c.kind === 'none') return []
  if (c.kind === 'grid') return [] // the panes name themselves; the header keeps its room for the grid's controls
  if (c.kind === 'project') return [{ label: c.project.name }]
  if (c.kind === 'feature') {
    const f = c.feature
    return [projectCrumb(projects, f.projectId), { label: f.title }]
  }
  if (c.kind === 'artifact') return artifactCrumbs(c.project, c.cluster.feature, c.card)
  // a session sits under its repo alone: a worktree's name and the linked feature both repeat the
  // branch the header already shows beside it
  const s = c.session
  return [projectCrumb(projects, repoHead(projects, s.projectId)), { label: s.label }]
}

// Cmd+1..9: visible pane n while the grid shows, else the nth session in sidebar order.
export function focusTarget(ui: UiState, projects: Project[], sessions: Session[], features: Feature[], n: number, view: GridView = DEFAULT_GRID_VIEW): Session | undefined {
  const c = content(ui, projects, sessions, features)
  return c.kind === 'grid' ? visibleMembers(c.sessions, view)[n - 1] : orderedSessions(listGroups(projects, sessions, ui))[n - 1]
}
