import { asksHuman } from '@shared/attention'
import { projectKey } from '@shared/groups'
import type { Project, Session, UiState } from '@shared/types'
import { repoGroups } from './repoGroups'
import { countsAsWaiting, shownStatus } from './sessionStatus'

export type SessionSort = UiState['sessionSort']

// A run of rows under one project's heading.
export interface ListGroup {
  key: string                      // p:<projectId>
  label: string
  project: Project | null
  collapsed: boolean
  sessions: Session[]
  nest: Nest                       // the same for every group of one list
}

// Session groups (a parent and its children). A child hides behind its parent: `sessions` above
// holds only the rows that stand on their own, and `kids` holds every child of a parent
// (promoted ones too, so the parent's counts and segments include them), in the same order.
export interface Nest {
  kids: Map<string, Session[]>
}

// The rows in the group.
export const groupSize = (g: ListGroup): number => g.sessions.length

// A parent's hidden children that ask the human right now: the rows shown "via parent" under it.
// A promoted child is a row of its own already, so it never shows twice.
export function viaParent(nest: Nest, parentId: string): Session[] {
  return (nest.kids.get(parentId) ?? []).filter((s) => !s.promoted && asksHuman(s))
}

export const SORT_OPTIONS: { value: SessionSort; label: string }[] = [
  { value: 'custom', label: 'Custom' },
  { value: 'viewed-desc', label: 'Last viewed ↓' },
  { value: 'viewed-asc', label: 'Last viewed ↑' },
  { value: 'created-desc', label: 'Created ↓' },
  { value: 'created-asc', label: 'Created ↑' },
  { value: 'status-age', label: 'Time in status' },
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

// Longest in its status first (core's statusAt), with the sessions that are your move (waiting,
// finished, failed) ahead of the rest, so the top row is the one that has waited on you longest.
// A session not stamped yet sorts as if it just changed.
const needsYou = (s: Session) => countsAsWaiting(s) || shownStatus(s) === 'failed'
const statusTime = (s: Session) => (s.statusAt ? Date.parse(s.statusAt) : Infinity)
const byStatusAge = (a: Session, b: Session) => {
  const na = needsYou(a), nb = needsYou(b)
  if (na !== nb) return na ? -1 : 1
  return statusTime(a) - statusTime(b) || byStarted(a, b)
}

const COMPARATORS: Record<Exclude<SessionSort, 'custom' | 'status-age'>, (a: Session, b: Session) => number> = {
  'viewed-desc': byViewed(true),
  'viewed-asc': byViewed(false),
  'created-desc': (a, b) => byStarted(b, a),
  'created-asc': byStarted,
}

// The Sessions tab as the sidebar draws it: groups under headings, rows in the chosen
// order inside each. Hidden projects are gone before anything is grouped, so every
// view drops them. Grouping puts a worktree's sessions in its repo's group.
export function listGroups(
  projects: Project[],
  sessions: Session[],
  ui: Pick<UiState, 'collapsed' | 'hiddenProjects' | 'hideDone' | 'sessionSort' | 'sessionOrder'>,
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
  const visible = sessions.filter((s) => !hidden.has(repoOf.get(s.projectId) ?? s.projectId) && !(ui.hideDone && s.workflowStatus === 'done'))
  const sort = ui.sessionSort === 'custom' ? byCustom(ui.sessionOrder ?? []) : ui.sessionSort === 'status-age' ? byStatusAge : COMPARATORS[ui.sessionSort] ?? byStarted
  // A session is a child of its parent when the parent is on screen and is not itself a child, so
  // a hidden or missing parent never hides the child with it. A promoted child is still a kid of
  // its parent but also a root; any other child is hidden behind the parent.
  const byId = new Map(visible.map((s) => [s.id, s] as const))
  const isChild = (s: Session) => !!s.link && !!byId.get(s.link.id) && !byId.get(s.link.id)!.link
  const kids = new Map<string, Session[]>()
  for (const s of visible) if (isChild(s)) kids.set(s.link!.id, [...(kids.get(s.link!.id) ?? []), s])
  for (const [id, list] of kids) kids.set(id, list.sort(sort))
  const nest: Nest = { kids }
  const roots = visible.filter((s) => !isChild(s) || s.promoted)
  return groups
    .filter(({ project }) => !hidden.has(project.id))
    .map(({ project }): ListGroup => {
      const key = projectKey(project.id)
      const members = roots.filter((s) => repoOf.get(s.projectId) === project.id)
      return { key, label: project.name, project, sessions: [...members].sort(sort), nest, collapsed: collapsed.has(key) }
    })
}

// Every visible row once, in group order, collapsed groups included, each root followed by its
// via-parent rows: what Cmd+1..9 counts through, so the number the human counts is the session
// they get. A shift-click range uses visibleSessions below
// instead, so a range that spans a collapsed group can't select — and so delete — sessions the
// human cannot see.
export function orderedSessions(groups: ListGroup[]): Session[] {
  return groups.flatMap((g) => g.sessions.flatMap((s) => [s, ...viaParent(g.nest, s.id)]))
}

// The same order, minus sessions inside collapsed groups: what a shift-click range runs over.
export function visibleSessions(groups: ListGroup[]): Session[] {
  return groups.filter((g) => !g.collapsed).flatMap((g) =>
    g.sessions.flatMap((s) => [s, ...viaParent(g.nest, s.id)]))
}

// Where a dragged card lands: beside `target` in `to`, before or after it.
export interface DropAt { target: string; after: boolean }

// What a drop changes: the new global order.
export interface DropResult { order: string[] }

// Whether a card may be dropped from one group into another. A project group is its own
// bounded list, so only the same group accepts there.
export function canDrop(from: ListGroup, to: ListGroup): boolean {
  return from.key === to.key
}

// The order after dropping `moved` into `to`, or null when the drop is refused or
// changes nothing. The order is the whole list of sessions, not just the group's: the card is
// cut out and put back beside its neighbour in the group, so every group still reads in one
// shared order. An empty group has no neighbour, and the card keeps its place in the order.
export function dropSession(
  sessions: Session[], order: string[],
  moved: Session, from: ListGroup, to: ListGroup, at: DropAt | null,
): DropResult | null {
  if (!canDrop(from, to) || at?.target === moved.id) return null
  const all = [...sessions].sort(byCustom(order)).map((s) => s.id)
  const rest = to.sessions.filter((s) => s.id !== moved.id)
  const next = all.filter((id) => id !== moved.id)
  const pos = at ? rest.findIndex((s) => s.id === at.target) + (at.after ? 1 : 0) : rest.length
  const anchor = rest.length === 0 ? -1 : pos < rest.length ? next.indexOf(rest[pos].id) : next.indexOf(rest[rest.length - 1].id) + 1
  next.splice(anchor < 0 ? all.indexOf(moved.id) : anchor, 0, moved.id)
  if (next.every((id, i) => id === all[i])) return null
  return { order: next }
}
