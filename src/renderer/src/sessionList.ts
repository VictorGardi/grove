import type { Project, Session, UiState, WorkflowStatus } from '@shared/types'
import { openedKey, projectKey, worktreeKey } from './tree'
import { repoGroups } from './repoGroups'
import { WORKFLOW_STATUSES } from './workflowStatus'

export type GroupBy = 'project' | 'status' | 'none'
export type SessionSort = 'none' | 'viewed-desc' | 'viewed-asc' | 'created-desc' | 'created-asc'

// A run of rows under one heading. Exactly one of project/status is set; `none`
// grouping sets neither and labels the whole list. A project's group carries its
// worktrees as `children`, one level deep (ADR 0037).
export interface ListGroup {
  key: string                      // p:<projectId> by project, s:<status> by status, all when ungrouped
  label: string
  project: Project | null
  status: WorkflowStatus | null
  collapsed: boolean
  sessions: Session[]
  children: ListGroup[]            // a worktree's own sessions, under the repo's
}

export const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'status', label: 'Workflow status' },
  { value: 'none', label: 'None' },
]

export const SORT_OPTIONS: { value: SessionSort; label: string }[] = [
  { value: 'none', label: 'Default' },
  { value: 'viewed-desc', label: 'Last viewed ↓' },
  { value: 'viewed-asc', label: 'Last viewed ↑' },
  { value: 'created-desc', label: 'Created ↓' },
  { value: 'created-asc', label: 'Created ↑' },
]

const byStarted = (a: Session, b: Session) => a.startedAt.localeCompare(b.startedAt)

// A session you have never looked at sinks to the bottom under both viewed orders —
// flipping the direction is about which end of the *viewed* ones you read first, not
// about promoting the untouched. Start time breaks ties so the order is stable.
const byViewed = (newestFirst: boolean) => (a: Session, b: Session) => {
  const av = a.lastFocusedAt ?? null
  const bv = b.lastFocusedAt ?? null
  if (av === null) return bv === null ? byStarted(a, b) : 1
  if (bv === null) return -1
  return (newestFirst ? bv.localeCompare(av) : av.localeCompare(bv)) || byStarted(a, b)
}

const COMPARATORS: Record<SessionSort, (a: Session, b: Session) => number> = {
  'none': byStarted,
  'viewed-desc': byViewed(true),
  'viewed-asc': byViewed(false),
  'created-desc': (a, b) => byStarted(b, a),
  'created-asc': byStarted,
}

// The Sessions tab as the sidebar draws it: groups under headings, rows in the chosen
// order inside each. Hidden projects are gone before anything is grouped, so every
// mode drops them. Grouping by project nests each worktree under its repo's checkout.
export function listGroups(
  projects: Project[],
  sessions: Session[],
  ui: Pick<UiState, 'collapsed' | 'hiddenProjects' | 'groupBy' | 'sessionSort'>,
): ListGroup[] {
  const collapsed = new Set(ui.collapsed)
  // `hiddenProjects` names repos, not checkouts: the repo is what the human shows and hides,
  // so a hidden repo takes its worktrees with it. An id that is not a checkout head — one
  // saved before worktrees were projects of their own — is ignored rather than left to hide
  // a checkout whose repo the sidebar still lists.
  const groups = repoGroups(projects)
  const named = new Set(ui.hiddenProjects ?? [])
  const hidden = new Set(groups.filter((g) => named.has(g.project.id)).map((g) => g.project.id))
  const repoOf = new Map(groups.flatMap((g) => [g.project, ...g.worktrees].map((p) => [p.id, g.project.id] as const)))
  const visible = sessions.filter((s) => !hidden.has(repoOf.get(s.projectId) ?? s.projectId))
  const sort = COMPARATORS[ui.sessionSort] ?? COMPARATORS['none']
  const group = (
    key: string, label: string, project: Project | null, status: WorkflowStatus | null,
    members: Session[], children: ListGroup[] = [], worktree = false,
  ): ListGroup => ({
    key, label, project, status, sessions: [...members].sort(sort), children,
    collapsed: worktree ? !collapsed.has(openedKey(key)) : collapsed.has(key),
  })

  if (ui.groupBy === 'status')
    // every status keeps its heading, empty ones included, so rows don't jump as statuses change
    return WORKFLOW_STATUSES.map(({ value, label }) => group('s:' + value, label, null, value, visible.filter((s) => s.workflowStatus === value)))
  if (ui.groupBy === 'none') return [group('all', 'All sessions', null, null, visible)]
  return groups
    .filter(({ project }) => !hidden.has(project.id))
    .map(({ project, worktrees }) => group(
      projectKey(project.id), project.name, project, null, visible.filter((s) => s.projectId === project.id),
      worktrees.map((w) => group(worktreeKey(w.id), w.name, w, null, visible.filter((s) => s.projectId === w.id), [], true)),
    ))
}

// The `ui.collapsed` key a group's heading writes when clicked. A worktree row starts
// collapsed, so its heading writes the key it was *opened* under, and one toggle then serves
// both directions without a second ui field.
export function collapseKey(g: ListGroup): string {
  return g.key.startsWith(worktreeKey('')) ? openedKey(g.key) : g.key
}

// Every visible session once, in group order, collapsed groups included: what Cmd+1..9 counts
// through. A shift-click range uses visibleSessions below instead, so a range that spans a
// collapsed group can't select — and so delete — sessions the human cannot see.
export function orderedSessions(groups: ListGroup[]): Session[] {
  return groups.flatMap((g) => [...g.sessions, ...orderedSessions(g.children)])
}

// The same order, minus sessions inside collapsed groups: what a shift-click range runs over.
export function visibleSessions(groups: ListGroup[]): Session[] {
  return groups.filter((g) => !g.collapsed).flatMap((g) => [...g.sessions, ...visibleSessions(g.children)])
}
