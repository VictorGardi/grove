// The sidebar and tab strip's rules as plain functions, so they run in tests without a DOM.
import type { AgentInfo, AgentStateName, ContextUsage } from '../protocol/messages.ts'
import type { AgentKind } from '../core/status/adapter.ts'
import { URGENCY } from '../protocol/rollup.ts'

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

export interface AgentRowInput {
  spaceId: string
  tabNumber: number
  agent: AgentInfo
  exited: boolean
}

// The row's rank as the row shows it: a gone tab shows idle, whatever its last stored state was.
function urgencyOf(row: AgentRowInput): number {
  return URGENCY.indexOf(row.exited ? 'idle' : row.agent.state)
}

// One group per space id, in the order of `spaceIds`. Empty groups are left out. Within a group, the most urgent row comes first,
// then the one waiting longest (the smallest `since`).
export function groupAgents<T extends AgentRowInput>(
  spaceIds: string[],
  rows: T[],
): Array<{ spaceId: string; rows: T[] }> {
  const groups: Array<{ spaceId: string; rows: T[] }> = []
  for (const spaceId of spaceIds) {
    const own = rows
      .filter((row) => row.spaceId === spaceId)
      .sort((a, b) => urgencyOf(a) - urgencyOf(b) || a.agent.since - b.agent.since)
    if (own.length > 0) groups.push({ spaceId, rows: own })
  }
  return groups
}

// A stable colour for a space: 1 to 8, from a hash of its name (the tile-1 to tile-8 classes).
export function tileIndex(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return (hash % 8) + 1
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

// The space ids in the order the sidebar lists them: each top-level space, then its worktrees. A worktree whose repo is not listed is top-level.
export function sidebarSpaceOrder(spaces: SpaceOrderInput[]): string[] {
  const ids = new Set(spaces.map((space) => space.id))
  const top = spaces.filter((space) => !space.parent || !ids.has(space.parent))
  return top.flatMap((space) => [space.id, ...spaces.filter((child) => child.parent === space.id).map((child) => child.id)])
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

function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Number((n / 1000).toFixed(1))}k`
  return `${Number((n / 1_000_000).toFixed(1))}M`
}

// A last request's time as the sidebar title shows it: local hours and minutes (epoch ms).
function hhmm(at: number): string {
  const time = new Date(at)
  return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
}

// The sidebar label for an agent's context use. A missing or non-positive reading gives no label: never a 0. The kind
// sets the wording: a Copilot reading is a timestamped last request measured against the CLI's prompt budget — never
// a context window. A reading without a budget shows the tokens alone and no ratio.
export function formatContext(context: ContextUsage | undefined, kind: AgentKind = 'claude'): { text: string; title: string } | null {
  if (!context || context.tokens === null || context.tokens <= 0) return null
  const { tokens, window, percent, model } = context
  const hasWindow = window !== null && window > 0
  const text = hasWindow ? `${compact(tokens)}/${compact(window)}` : compact(tokens)
  const pct = percent ?? (hasWindow ? Math.round((tokens / window) * 100) : null)
  const ratio = pct === null ? '' : ` (${pct}%)`
  const models = model ? `, ${model}` : ''
  if (kind === 'copilot') {
    const used = hasWindow
      ? `${tokens.toLocaleString('en-US')} of ${window.toLocaleString('en-US')} prompt tokens`
      : `${tokens.toLocaleString('en-US')} prompt tokens`
    return { text, title: `Last request: ${used}${ratio}${models}, ${hhmm(context.at)}` }
  }
  const used = hasWindow ? `${tokens.toLocaleString('en-US')} of ${window.toLocaleString('en-US')} tokens` : `${tokens.toLocaleString('en-US')} tokens`
  return { text, title: `Context: ${used}${ratio}${models}` }
}
