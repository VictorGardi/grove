import type { Feature, Project, Session, UiState } from '@shared/types'

// What the content area shows (ADR 0018): one of three exclusive focuses, else the first project's page.
export type Content =
  | { kind: 'project'; project: Project }
  | { kind: 'feature'; feature: Feature }
  | { kind: 'session'; session: Session }
  | { kind: 'none' }

export interface Crumb { label: string; to?: Partial<UiState> } // `to`: the ui:set partial an up-link applies

const findFeature = (features: Feature[], projectId: string, slug: string | null) =>
  slug === null ? undefined : features.find((f) => f.projectId === projectId && f.slug === slug)

export function content(ui: UiState, projects: Project[], sessions: Session[], features: Feature[]): Content {
  const session = ui.focusedSessionId && sessions.find((s) => s.id === ui.focusedSessionId)
  if (session) return { kind: 'session', session }
  const ff = ui.focusedFeature
  const feature = ff && findFeature(features, ff.projectId, ff.slug)
  if (feature) return { kind: 'feature', feature }
  const project = projects.find((p) => p.id === (ui.focusedProject ?? ff?.projectId)) ?? projects[0]
  return project ? { kind: 'project', project } : { kind: 'none' }
}

const projectCrumb = (projects: Project[], id: string): Crumb =>
  ({ label: projects.find((p) => p.id === id)?.name ?? id, to: { focusedProject: id } })
const featureCrumb = (f: Feature): Crumb => ({ label: f.title, to: { focusedFeature: { projectId: f.projectId, slug: f.slug } } })

// Breadcrumb up-links; the last crumb is the current page and has no `to`.
export function crumbs(c: Content, projects: Project[], features: Feature[]): Crumb[] {
  if (c.kind === 'none') return []
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
