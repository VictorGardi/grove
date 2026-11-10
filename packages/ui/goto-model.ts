// The Go to overlay's rules as plain functions, so they run in tests without a DOM.
import type { AgentStateName } from '../protocol/messages.ts'
import type { AgentKind } from '../core/status/adapter.ts'
import { indicatorLabel } from './indicator.ts'

export interface GoToSpace {
  id: string
  name: string
  parent: string | null
  worktree: boolean
  repoName: string | null
}

export interface GoToTab {
  id: string
  spaceId: string
  name: string
  // The agent the tab runs, or null for a plain shell.
  agent: AgentKind | null
  // The state as the tab shows it (see tabStateOf), so a gone tab is idle.
  state: AgentStateName
}

export interface GoToInput {
  spaces: GoToSpace[]
  tabs: GoToTab[]
  // Tab ids, most recently visited first.
  recent: string[]
  activeSpaceId: string | null
  activeTabId: string | null
  query: string
  expandQuiet: boolean
}

export interface GoToRow {
  tabId: string
  name: string
  state: AgentStateName
  agent: AgentKind | null
  agentName: string | null
  // The state in words when the human may care (working, needs you, finished), else null.
  stateLabel: string | null
}

// What a tab's agent is called in a row, and what the query can match.
const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude Code', opencode: 'OpenCode', copilot: 'Copilot' }

// How well `term` matches `text` as a subsequence, higher is better; null when it does not match. Runs of consecutive
// characters and characters that start a word score more, and a shorter text beats a longer one.
export function fuzzyScore(term: string, text: string): number | null {
  const wanted = term.toLowerCase()
  const haystack = text.toLowerCase()
  let at = 0
  let previous = -2
  let score = 0
  for (let i = 0; i < haystack.length && at < wanted.length; i++) {
    if (haystack[i] !== wanted[at]) continue
    score += 1
    if (i === previous + 1) score += 2
    if (i === 0 || ' -_/.'.includes(haystack[i - 1])) score += 3
    previous = i
    at++
  }
  return at === wanted.length ? score - (haystack.length - wanted.length) * 0.01 : null
}

// A row's score for the whole query: every word of it must match the tab name, the space name or the agent name.
function queryScore(terms: string[], fields: string[]): number | null {
  let total = 0
  for (const term of terms) {
    const best = fields.reduce<number | null>((top, field) => {
      const score = fuzzyScore(term, field)
      return score !== null && (top === null || score > top) ? score : top
    }, null)
    if (best === null) return null
    total += best
  }
  return total
}

export interface GoToGroup {
  spaceId: string
  name: string
  // The name of the space this worktree belongs to, or null for any other space.
  worktreeOf: string | null
  rows: GoToRow[]
}

export interface GoToView {
  groups: GoToGroup[]
  // The tab the highlight starts on: the current tab, else the first row. Null with no rows.
  highlight: string | null
  // The collapsed idle spaces, null when there are none or a query is searching all of them.
  quiet: { count: number; expanded: boolean } | null
}

const BUSY: readonly AgentStateName[] = ['working', 'needs-you', 'finished']

function rowOf(tab: GoToTab): GoToRow {
  const stateLabel = BUSY.includes(tab.state) ? indicatorLabel(tab.state) : null
  return { tabId: tab.id, name: tab.name, state: tab.state, agent: tab.agent, agentName: tab.agent ? AGENT_NAMES[tab.agent] : null, stateLabel }
}

// How far back a tab was visited: 0 is the latest. A tab never visited is after all that were.
function recency(recent: string[], tabId: string): number {
  const at = recent.indexOf(tabId)
  return at === -1 ? recent.length : at
}

export function goToView(input: GoToInput): GoToView {
  const terms = input.query.split(/\s+/).filter(Boolean)
  const searching = terms.length > 0
  const entries = input.spaces.flatMap((space) => {
    const own = input.tabs.filter((tab) => tab.spaceId === space.id)
    const scored = own.flatMap((tab) => {
      const fields = [tab.name, space.name, ...(tab.agent ? [AGENT_NAMES[tab.agent]] : [])]
      const score = searching ? queryScore(terms, fields) : 0
      return score === null ? [] : [{ tab, score }]
    })
    if (searching && scored.length === 0) return []
    scored.sort((a, b) => b.score - a.score || recency(input.recent, a.tab.id) - recency(input.recent, b.tab.id))
    const latest = Math.min(...own.map((tab) => recency(input.recent, tab.id)), input.recent.length)
    const quiet = !searching && space.id !== input.activeSpaceId && !own.some((tab) => BUSY.includes(tab.state))
    const top = scored[0]?.score ?? 0
    const rows = scored.map(({ tab }) => rowOf(tab))
    const worktree = space.worktree || space.parent !== null
    const parent = input.spaces.find((other) => other.id === space.parent)
    const worktreeOf = worktree ? (parent?.name ?? space.repoName) : null
    return [{ quiet, latest, top, current: space.id === input.activeSpaceId, group: { spaceId: space.id, name: space.name, worktreeOf, rows } }]
  })
  // Array.prototype.sort is stable, so spaces equally recent keep the sidebar order they came in.
  if (searching) entries.sort((a, b) => b.top - a.top || a.latest - b.latest)
  else entries.sort((a, b) => Number(b.current) - Number(a.current) || a.latest - b.latest)
  const quiet = entries.filter((entry) => entry.quiet)
  const listed = quiet.length > 0 && !input.expandQuiet ? entries.filter((entry) => !entry.quiet) : entries
  const groups = listed.map((entry) => entry.group)
  const rows = groups.flatMap((group) => group.rows)
  const current = !searching ? rows.find((row) => row.tabId === input.activeTabId) : undefined
  const highlight = (current ?? rows[0])?.tabId ?? null
  return { groups, highlight, quiet: quiet.length > 0 ? { count: quiet.length, expanded: input.expandQuiet } : null }
}
