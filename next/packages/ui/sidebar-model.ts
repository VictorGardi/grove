// The sidebar and tab strip's rules as plain functions, so they run in tests without a DOM.
import type { AgentInfo, AgentStateName } from '../protocol/messages.ts'
import type { AgentKind } from '../core/status/adapter.ts'
import { URGENCY } from '../protocol/rollup.ts'

export interface TabStateInput {
  exited: boolean
  kind: 'shell' | AgentKind
  state: AgentStateName | null
}

// A gone tab and a shell are idle. An agent tab with no status yet is unknown, not idle: a guess is not hidden behind idle.
export function tabStateOf(tab: TabStateInput): AgentStateName {
  if (tab.exited || tab.kind === 'shell') return 'idle'
  return tab.state ?? 'unknown'
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
