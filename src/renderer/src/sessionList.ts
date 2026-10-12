import { openedKey, projectKey, worktreeKey } from '@shared/groups'
import type { Project, Session, UiState, WorkflowStatus } from '@shared/types'
import { repoGroups } from './repoGroups'
import { WORKFLOW_STATUSES } from './workflowStatus'

export type GroupBy = 'project' | 'status' | 'none'
export type SessionSort = 'custom' | 'viewed-desc' | 'viewed-asc' | 'created-desc' | 'created-asc'

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
  { value: 'custom', label: 'Custom' },
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

// The dragged order (ADR 0041). A session the human has never placed sorts below every placed
// one, in creation order, so a list nobody has dragged yet reads exactly as created-asc does.
const byCustom = (order: string[]) => {
  const rank = new Map(order.map((id, i) => [id, i] as const))
  return (a: Session, b: Session) => {
    const ar = rank.get(a.id)
    const br = rank.get(b.id)
    if (ar === undefined) return br === undefined ? byStarted(a, b) : 1
    if (br === undefined) return -1
    return ar - br
  }
}

const COMPARATORS: Record<Exclude<SessionSort, 'custom'>, (a: Session, b: Session) => number> = {
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
  ui: Pick<UiState, 'collapsed' | 'hiddenProjects' | 'groupBy' | 'sessionSort' | 'sessionOrder'>,
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
  const sort = ui.sessionSort === 'custom' ? byCustom(ui.sessionOrder ?? []) : COMPARATORS[ui.sessionSort] ?? byStarted
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

// Where a dragged card lands: beside `target` in `to`, before or after it.
export interface DropAt { target: string; after: boolean }

// What a drop changes: the new global order, and the workflow status the card takes when it
// crossed into another status group (null leaves it alone).
export interface DropResult { order: string[]; status: WorkflowStatus | null }

// Whether a card may be dropped from one group into another. A project group is its own
// bounded list, and a repo and its worktree are two groups of it, so only the same group
// accepts there. Status and ungrouped lists take any group.
export function canDrop(groupBy: GroupBy, from: ListGroup, to: ListGroup): boolean {
  return groupBy !== 'project' || from.key === to.key
}

// The order and status after dropping `moved` into `to`, or null when the drop is refused or
// changes nothing. The order is the whole list of sessions, not just the group's: the card is
// cut out and put back beside its neighbour in the group, so every group still reads in one
// shared order. An empty group has no neighbour, and the card keeps its place in the order.
export function dropSession(
  groupBy: GroupBy, sessions: Session[], order: string[],
  moved: Session, from: ListGroup, to: ListGroup, at: DropAt | null,
): DropResult | null {
  if (!canDrop(groupBy, from, to) || at?.target === moved.id) return null
  const status = groupBy === 'status' && to.status && to.status !== moved.workflowStatus ? to.status : null
  const all = [...sessions].sort(byCustom(order)).map((s) => s.id)
  const rest = to.sessions.filter((s) => s.id !== moved.id)
  const next = all.filter((id) => id !== moved.id)
  const pos = at ? rest.findIndex((s) => s.id === at.target) + (at.after ? 1 : 0) : rest.length
  const anchor = rest.length === 0 ? -1 : pos < rest.length ? next.indexOf(rest[pos].id) : next.indexOf(rest[rest.length - 1].id) + 1
  next.splice(anchor < 0 ? all.indexOf(moved.id) : anchor, 0, moved.id)
  if (status === null && next.every((id, i) => id === all[i])) return null
  return { order: next, status }
}
