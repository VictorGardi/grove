// The Go to overlay's rules as plain functions, so they run in tests without a DOM.
import type { AgentStateName, NeedsYouReason } from '../protocol/messages.ts'
import type { AgentKind } from '../core/status/adapter.ts'
import { indicatorLabel } from './indicator.ts'
import { worktreeOf as worktreeOfSpace } from './sidebar-model.ts'
import { BUSY, quietSpaces, RECENT_SPACES, visitRank } from './quiet-spaces.ts'

export { RECENT_SPACES }

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
  // Why the tab needs the human, when it does and the agent said.
  reason?: NeedsYouReason
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
  // The state in words when the human may care (working, needs you, finished), else null. A needs-you row adds its reason.
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

// A row's score for the whole query: every word of it must match the tab name, the space name, its repo's name or the agent name.
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
  // The collapsed idle spaces, null when there are none or a query is searching all of them. `last` names the one visited
  // most recently, null when none of them was visited.
  quiet: { count: number; expanded: boolean; last: string | null } | null
}

// How urgent a tab is to the human: lower comes first.
function urgency(state: AgentStateName): number {
  return state === 'needs-you' ? 0 : state === 'finished' ? 1 : state === 'working' ? 2 : 3
}

// What a query word can say besides text: `!` keeps tabs that need you, `~` tabs that are working, at the start of a word.
const FILTERS: Record<string, AgentStateName> = { '!': 'needs-you', '~': 'working' }

// The marks a query carries, each at the start of a word, so a chip can show whether it is on.
export function marksOf(query: string): Set<string> {
  const marks = new Set<string>()
  for (const word of query.split(/\s+/)) {
    for (let at = 0; word[at] in FILTERS; at++) marks.add(word[at])
  }
  return marks
}

// The query with `mark` switched: taken off every word that carries it, or put at the start of the query when none does.
export function toggleMark(query: string, mark: string): string {
  if (!marksOf(query).has(mark)) return mark + query.trimStart()
  const words = query
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      let at = 0
      while (word[at] in FILTERS) at++
      return [...word.slice(0, at)].filter((char) => char !== mark).join('') + word.slice(at)
    })
    .filter(Boolean)
  return words.length > 0 ? `${words.join(' ')} ` : ''
}

function rowOf(tab: GoToTab): GoToRow {
  const label = BUSY.includes(tab.state) ? indicatorLabel(tab.state) : null
  const stateLabel = label && tab.state === 'needs-you' && tab.reason ? `${label} · ${tab.reason}` : label
  return { tabId: tab.id, name: tab.name, state: tab.state, agent: tab.agent, agentName: tab.agent ? AGENT_NAMES[tab.agent] : null, stateLabel }
}

export function goToView(input: GoToInput): GoToView {
  const words = input.query.split(/\s+/).filter(Boolean)
  const searching = words.length > 0
  const states = new Set<AgentStateName>()
  const terms: string[] = []
  for (const word of words) {
    let text = word
    while (text[0] in FILTERS) {
      states.add(FILTERS[text[0]])
      text = text.slice(1)
    }
    if (text) terms.push(text)
  }
  const entries = input.spaces.flatMap((space) => {
    const own = input.tabs.filter((tab) => tab.spaceId === space.id)
    const worktreeOf = worktreeOfSpace(space, input.spaces)
    const scored = own.flatMap((tab) => {
      if (states.size > 0 && !states.has(tab.state)) return []
      // A worktree is found by its repo's name too, so searching for a repo lists its worktrees with it.
      const fields = [tab.name, space.name, ...(worktreeOf ? [worktreeOf] : []), ...(tab.agent ? [AGENT_NAMES[tab.agent]] : [])]
      const score = terms.length > 0 ? queryScore(terms, fields) : 0
      return score === null ? [] : [{ tab, score }]
    })
    if (searching && scored.length === 0) return []
    scored.sort((a, b) => b.score - a.score || (searching ? 0 : urgency(a.tab.state) - urgency(b.tab.state)) || visitRank(input.recent, a.tab.id) - visitRank(input.recent, b.tab.id))
    const latest = Math.min(...own.map((tab) => visitRank(input.recent, tab.id)), input.recent.length)
    const tier = own.some((tab) => tab.state === 'needs-you') ? 0 : own.some((tab) => tab.state === 'finished') ? 1 : space.id === input.activeSpaceId ? 2 : own.some((tab) => tab.state === 'working') ? 3 : 4
    const top = scored[0]?.score ?? 0
    const rows = scored.map(({ tab }) => rowOf(tab))
    return [{ tier, latest, top, current: space.id === input.activeSpaceId, group: { spaceId: space.id, name: space.name, worktreeOf, rows } }]
  })
  // Array.prototype.sort is stable, so spaces equally recent keep the sidebar order they came in.
  if (searching) entries.sort((a, b) => b.top - a.top || a.latest - b.latest)
  else entries.sort((a, b) => a.tier - b.tier || a.latest - b.latest)
  // A query searches every space, so only an empty one folds the quiet ones.
  const folded = searching ? { ids: new Set<string>(), last: null } : quietSpaces({ spaces: input.spaces, tabs: input.tabs, recent: input.recent, activeSpaceId: input.activeSpaceId })
  const quiet = entries.filter((entry) => folded.ids.has(entry.group.spaceId))
  const listed = quiet.length > 0 && !input.expandQuiet ? entries.filter((entry) => !quiet.includes(entry)) : entries
  const groups = listed.map((entry) => entry.group)
  const rows = groups.flatMap((group) => group.rows)
  const current = !searching ? rows.find((row) => row.tabId === input.activeTabId) : undefined
  const highlight = (current ?? rows[0])?.tabId ?? null
  return { groups, highlight, quiet: quiet.length > 0 ? { count: quiet.length, expanded: input.expandQuiet, last: entries.find((entry) => entry.group.spaceId === folded.last)?.group.name ?? null } : null }
}
