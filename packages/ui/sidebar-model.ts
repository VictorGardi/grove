// The sidebar and tab strip's rules as plain functions, so they run in tests without a DOM.
import type { AgentStateName, ContextUsage } from '../protocol/messages.ts'
import type { AgentKind } from '../core/status/adapter.ts'
import { contextLevel } from '../protocol/context-level.ts'
import { URGENCY } from '../protocol/rollup.ts'
import { visitRank } from './quiet-spaces.ts'

export interface TabStateInput {
  exited: boolean
  kind: 'shell' | AgentKind
  state: AgentStateName | null
}

// A gone tab is idle. A tab the core watches shows its agent's state, whatever kind it was created as: an agent typed
// into a shell tab is watched like a launched one. Otherwise a shell is idle, and an agent tab with no status yet is
// unknown, not idle: a guess is not hidden behind idle.
export function tabStateOf(tab: TabStateInput): AgentStateName {
  if (tab.exited) return 'idle'
  if (tab.state !== null) return tab.state
  return tab.kind === 'shell' ? 'idle' : 'unknown'
}

export interface WorktreeInput extends SpaceOrderInput {
  worktree: boolean
  repoName: string | null
}

// The name of the repo a worktree space belongs to: its parent space's name, else the repo folder's. Null for any other space.
export function worktreeOf(space: WorktreeInput, spaces: Array<SpaceOrderInput & { name: string }>): string | null {
  if (!space.worktree && space.parent === null) return null
  return spaces.find((other) => other.id === space.parent)?.name ?? space.repoName
}

// The folder as the panes show it: the home folder as `~`, anything else in full.
export function shortFolder(path: string, home: string): string {
  if (!home) return path
  if (path === home) return '~'
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`
  return path
}

export interface SpaceOrderInput {
  id: string
  parent: string | null
}

export interface SidebarSpace extends SpaceOrderInput {
  name: string
  // The name the human gave, or null.
  label: string | null
  worktree: boolean
  repoName: string | null
  branch: string | null
}

// A space as a row: a main checkout is a row beside the worktree spaces under its repo's heading, and is named differently.
export interface SidebarRow<T extends SidebarSpace = SidebarSpace> {
  space: T
  main: boolean
}

// What the sidebar lists, top to bottom: a repo's heading with its rows (its main checkout spaces first, then its worktree
// spaces), or a plain space with no heading. The heading is keyed by the repo's name, not by a main checkout space, so it
// survives that space being added or removed.
export type SidebarItem<T extends SidebarSpace = SidebarSpace> =
  | { kind: 'heading'; repo: string; rows: Array<SidebarRow<T>> }
  | { kind: 'plain'; row: SidebarRow<T> }

// The repo a worktree space belongs to: its own repo name, else its main checkout space's. Null when the space is not a worktree,
// or when git could not say which repo it is a worktree of: it is then a plain row.
function repoOf(space: SidebarSpace, byId: Map<string, SidebarSpace>): string | null {
  if (!space.worktree && space.parent === null) return null
  const parent = space.parent === null ? undefined : byId.get(space.parent)
  return space.repoName ?? parent?.repoName ?? parent?.name ?? null
}

export function sidebarItems<T extends SidebarSpace>(spaces: T[]): Array<SidebarItem<T>> {
  const byId = new Map(spaces.map((space) => [space.id, space]))
  // The repo of each main checkout space: that of the first worktree space listed under it.
  const mainRepo = new Map<string, string>()
  for (const space of spaces) {
    const repo = repoOf(space, byId)
    if (repo !== null && space.parent !== null && byId.has(space.parent) && !mainRepo.has(space.parent)) mainRepo.set(space.parent, repo)
  }
  const items: Array<SidebarItem<T>> = []
  const headings = new Map<string, { mains: Array<SidebarRow<T>>; trees: Array<SidebarRow<T>> }>()
  const join = (repo: string, row: SidebarRow<T>): void => {
    let heading = headings.get(repo)
    if (!heading) {
      heading = { mains: [], trees: [] }
      headings.set(repo, heading)
      items.push({ kind: 'heading', repo, rows: [] })
    }
    ;(row.main ? heading.mains : heading.trees).push(row)
  }
  for (const space of spaces) {
    const repo = repoOf(space, byId)
    const main = mainRepo.get(space.id)
    if (repo !== null) join(repo, { space, main: false })
    else if (main !== undefined) join(main, { space, main: true })
    else items.push({ kind: 'plain', row: { space, main: false } })
  }
  for (const item of items) {
    if (item.kind !== 'heading') continue
    const heading = headings.get(item.repo)!
    item.rows = [...heading.mains, ...heading.trees]
  }
  return items
}

// The row's name: a main checkout's is the human's rename, else its branch, else its folder (detached, or git cannot say);
// any other space's is its name.
export function rowName(row: SidebarRow): string {
  const { space } = row
  return row.main ? (space.label ?? space.branch ?? space.name) : space.name
}

// Whether a heading draws its rows: the human's saved fold, except that the active space's heading stays open while it is active.
export function headingOpen(repo: string, folded: string[], activeRepo: string | null): boolean {
  return repo === activeRepo || !folded.includes(repo)
}

// The repo whose heading holds the space; null for a plain row or no space.
export function headingOf(items: SidebarItem[], spaceId: string | null): string | null {
  for (const item of items) if (item.kind === 'heading' && item.rows.some((row) => row.space.id === spaceId)) return item.repo
  return null
}

// The most urgent of the states, null for none.
export function mostUrgent(states: AgentStateName[]): AgentStateName | null {
  return states.reduce<AgentStateName | null>((top, state) => (top === null || URGENCY.indexOf(state) < URGENCY.indexOf(top) ? state : top), null)
}

// The sidebar's list with its quiet spaces folded away: a plain space leaves it when quiet, a heading only when all its rows
// are. `count` counts the spaces that left.
export function foldQuiet<T extends SidebarSpace>(items: Array<SidebarItem<T>>, quiet: { ids: Set<string> }): { items: Array<SidebarItem<T>>; count: number } {
  const kept = items.filter((item) => (item.kind === 'plain' ? !quiet.ids.has(item.row.space.id) : item.rows.some((row) => !quiet.ids.has(row.space.id))))
  const gone = items.filter((item) => !kept.includes(item))
  return { items: kept, count: gone.reduce((sum, item) => sum + (item.kind === 'plain' ? 1 : item.rows.length), 0) }
}

// The space ids in the order the sidebar lists them, hidden rows included.
export function sidebarSpaceOrder(spaces: SidebarSpace[]): string[] {
  return sidebarItems(spaces).flatMap((item) => (item.kind === 'heading' ? item.rows : [item.row]).map((row) => row.space.id))
}

// The space at place n of the sidebar order, counted from 1. Null for a place past the last space.
export function spaceAt(order: string[], n: number): string | null {
  return order[n - 1] ?? null
}

export interface UrgentInput {
  id: string
  // The state as the tab shows it (see tabStateOf), so a gone tab is idle.
  state: AgentStateName
  since: number
}

const URGENT_STATES: readonly AgentStateName[] = ['needs-you', 'finished']

// The tabs that have something for the human, in any space: tabs that need them first, then finished ones, the one waiting
// longest (the smallest `since`) first. A working, unknown or idle tab, and a gone one, is not in it.
export function urgentTabs<T extends UrgentInput>(tabs: T[]): T[] {
  return tabs
    .filter((tab) => URGENT_STATES.includes(tab.state))
    .sort((a, b) => URGENT_STATES.indexOf(a.state) - URGENT_STATES.indexOf(b.state) || a.since - b.since)
}

// Where Cmd+. goes: the urgent tabs, or, when there are none, the working ones, the longest running (the smallest `since`) first.
export function jumpTargets<T extends UrgentInput>(tabs: T[]): T[] {
  const urgent = urgentTabs(tabs)
  if (urgent.length > 0) return urgent
  return tabs.filter((tab) => tab.state === 'working').sort((a, b) => a.since - b.since)
}

// The tab after the active one in `urgent`, wrapping round; the first one when the active tab is not in it. Null when there is
// nothing to go to: no urgent tab, or the active tab is the only one.
export function nextUrgent<T extends UrgentInput>(urgent: T[], activeId: string | null): T | null {
  const at = urgent.findIndex((tab) => tab.id === activeId)
  if (at === -1) return urgent[0] ?? null
  return urgent.length > 1 ? urgent[(at + 1) % urgent.length] : null
}

// A last request's time as the tooltip shows it: local hours and minutes (epoch ms).
function hhmm(at: number): string {
  const time = new Date(at)
  return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
}

// Thousands and millions with one decimal at most: 124000 is 124k, 101079 is 101.1k.
function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Number((n / 1000).toFixed(1))}k`
  return `${Number((n / 1_000_000).toFixed(1))}M`
}

// What the context circle draws: the pie fills by `fraction`, and the tooltip reads `headline` over `detail`.
export interface ContextView {
  // The used share of the window, 0 to 1. Null when there is no window to measure against: the circle is then unfilled.
  fraction: number | null
  // The window is used up.
  full: boolean
  // The reading's context level is warn: the circle and the readout turn to the warning colour.
  warn: boolean
  // The level is handoff, short of full: they turn to the error colour, as full does.
  handoff: boolean
  // A last request, not the current occupancy: the circle is drawn faded.
  last: boolean
  headline: string
  detail: string
}

// The circle's view of an agent's context reading, or null when there is nothing to draw: no tokens, or no window to
// fill the pie against. Claude's reading is the current occupancy of its window. A Copilot reading is a timestamped last
// request against the CLI's prompt budget, never a context window; an OpenCode reading is a timestamped last request
// against the model catalog's limit. Both say so in the detail.
export function contextView(context: ContextUsage | undefined, kind: AgentKind = 'claude'): ContextView | null {
  if (!context || context.tokens === null || context.tokens <= 0) return null
  const { tokens, window, percent, model } = context
  const level = contextLevel(context)
  if (window === null || window <= 0) {
    // Copilot's record may carry no prompt budget: the input tokens alone, timed as a last request, never a percentage.
    if (kind !== 'copilot') return null
    const counts = `${compact(tokens)} prompt tokens`
    return {
      fraction: null,
      full: false,
      warn: level === 'warn',
      handoff: level === 'handoff',
      last: true,
      headline: `${counts} · last request ${hhmm(context.at)}`,
      detail: model ? `no prompt budget · ${model}` : 'no prompt budget',
    }
  }
  const pct = Math.round(percent ?? (tokens / window) * 100)
  const full = pct >= 100
  const warn = !full && level === 'warn'
  const handoff = !full && level === 'handoff'
  const last = kind !== 'claude'
  const headline = full ? `${pct}% · full` : last ? `${pct}% · last request ${hhmm(context.at)}` : `${pct}% used`
  const source = kind === 'copilot' ? ' prompt budget' : kind === 'opencode' ? ' model limit' : ''
  const counts = `${compact(tokens)} / ${compact(window)}${source}`
  const detail = model ? `${counts} · ${model}` : counts
  return { fraction: Math.min(Math.max(pct, 0), 100) / 100, full, warn, handoff, last, headline, detail }
}

export interface SummaryTab {
  id: string
  // The agent the tab runs, whether launched as one or typed into a shell tab and watched; null for a plain shell.
  agent: AgentKind | null
  exited: boolean
  // The state as the tab shows it (see tabStateOf).
  state: AgentStateName
  // When the tab's state began (epoch ms); null when the core sent none, as for a shell.
  since: number | null
}

// What a row shows of its space's tabs. With no live tab it is empty: `state` is idle, and there is nothing to count.
export interface RowSummary {
  empty: boolean
  state: AgentStateName
  // The deciding tab: the most urgent live one, ties to the most recently visited.
  tabId: string | null
  agents: number
  // The agent the first live agent tab runs, for the agent icon beside the count; null with no live agent.
  agentKind: AgentKind | null
  terminals: number
  // When the deciding tab's state began; null when it has no such time.
  since: number | null
}

// `recent` is the tab ids, most recently visited first. A gone tab is left out of the counts and does not decide.
export function rowSummary(tabs: SummaryTab[], recent: string[]): RowSummary {
  const live = tabs.filter((tab) => !tab.exited)
  const [top] = [...live].sort((a, b) => URGENCY.indexOf(a.state) - URGENCY.indexOf(b.state) || visitRank(recent, a.id) - visitRank(recent, b.id))
  const agentTabs = live.filter((tab) => tab.agent !== null)
  return {
    empty: top === undefined,
    state: top?.state ?? 'idle',
    tabId: top?.id ?? null,
    agents: agentTabs.length,
    agentKind: agentTabs[0]?.agent ?? null,
    terminals: live.length - agentTabs.length,
    since: top?.since ?? null,
  }
}
