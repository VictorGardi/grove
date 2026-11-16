// The Go to overlay's rules as plain functions, so they run in tests without a DOM.
import type { AgentStateName, NeedsYouReason } from '../protocol/messages.ts'
import type { AgentKind } from '../core/status/adapter.ts'
import { indicatorLabel } from './indicator.ts'
import { URGENCY } from '../protocol/rollup.ts'
import { mostUrgent, rowName, shortFolder, sidebarItems, worktreeOf as worktreeOfSpace, type SidebarSpace } from './sidebar-model.ts'
import { BUSY, quietSpaces, RECENT_SPACES, visitRank } from './quiet-spaces.ts'

export { RECENT_SPACES }

// A space as the sidebar lists it, so Go to can draw the same tree and name rows the same way.
export type GoToSpace = SidebarSpace

export interface GoToTab {
  id: string
  spaceId: string
  name: string
  // The agent the tab runs, or null for a plain shell.
  agent: AgentKind | null
  // The state as the tab shows it (see tabStateOf), so a gone tab is idle.
  state: AgentStateName
  // When the tab's state began (epoch ms), if known.
  since?: number | null
  // Why the tab needs the human, when it does and the agent said.
  reason?: NeedsYouReason
  // The tab's process ended: it does not count towards its space's state.
  exited?: boolean
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
  // What the highlight is kept by: the tab's id for a tab row, `space:<id>` for a worktree row in the results.
  key: string
  // The tab Enter goes to: the row's own tab, or for a worktree row its deciding tab (the one that needs you).
  tabId: string
  name: string
  state: AgentStateName
  agent: AgentKind | null
  agentName: string | null
  // The state in words when the human may care (working, needs you, finished), else null. A needs-you row adds its reason.
  stateLabel: string | null
  // When the state began, if known.
  since: number | null
  // The characters of `name` the query matched, for the highlight (results only).
  matched: number[]
  // The muted line under a result: the repo, and for a tab the space it is in.
  where: string
  // A worktree row's open tabs, counted by type (results only).
  open: { agents: number; terminals: number; agent: AgentKind | null } | null
}

// What a tab's agent is called in a row, and what the query can match.
const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude Code', opencode: 'OpenCode', copilot: 'Copilot' }

// How well `term` matches `text` as a subsequence, higher is better, with the matched character places; null when it does
// not match. Runs of consecutive characters and characters that start a word score more, and a shorter text beats a longer one.
export function fuzzyMatch(term: string, text: string): { score: number; at: number[] } | null {
  const wanted = term.toLowerCase()
  const haystack = text.toLowerCase()
  let next = 0
  let previous = -2
  let score = 0
  const at: number[] = []
  // A run of the whole word, when the text has one, is the match; else the first characters in order.
  const run = haystack.indexOf(wanted)
  for (let i = Math.max(run, 0); i < haystack.length && next < wanted.length; i++) {
    if (haystack[i] !== wanted[next]) continue
    score += 1
    if (i === previous + 1) score += 2
    if (i === 0 || ' -_/.'.includes(haystack[i - 1])) score += 3
    previous = i
    at.push(i)
    next++
  }
  return next === wanted.length ? { score: score - (haystack.length - wanted.length) * 0.01, at } : null
}

export function fuzzyScore(term: string, text: string): number | null {
  return fuzzyMatch(term, text)?.score ?? null
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
  // The name the sidebar's row gives the space (see rowName).
  name: string
  // The repo whose heading the space sits under in the sidebar's tree, or null for a plain space.
  repo: string | null
  // The space's most urgent state over its live tabs, whatever the query filtered out; `empty` when it has no live tab.
  state: AgentStateName
  empty: boolean
  // How many tabs the space has. A space with exactly one is drawn as a single row, `single`, the tab hanging under no header.
  tabCount: number
  single: boolean
  // The name of the space this worktree belongs to, or null for any other space.
  worktreeOf: string | null
  rows: GoToRow[]
}

export interface GoToView {
  groups: GoToGroup[]
  // With a text query, the flat ranked results (worktrees, then tabs) the overlay draws instead of the groups; null otherwise.
  results: { worktrees: GoToRow[]; tabs: GoToRow[] } | null
  // The rows the arrow keys walk, in the order they are drawn.
  rows: GoToRow[]
  // The tabs that need you or are working among those the words of the query match (state filters aside), for the chips.
  counts: { needsYou: number; working: number }
  // The row the highlight starts on, by its key: the current tab, else the first row (the top hit with a query). Null with no rows.
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
  return {
    key: tab.id,
    tabId: tab.id,
    name: tab.name,
    state: tab.state,
    agent: tab.agent,
    agentName: tab.agent ? AGENT_NAMES[tab.agent] : null,
    stateLabel,
    since: tab.since ?? null,
    matched: [],
    where: '',
    open: null,
  }
}

// The places of `name` that any of the words matched.
function matchedOf(terms: string[], name: string): number[] {
  return [...new Set(terms.flatMap((term) => fuzzyMatch(term, name)?.at ?? []))].sort((a, b) => a - b)
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
  const placed = new Map<string, { repo: string | null; main: boolean }>()
  for (const item of sidebarItems(input.spaces)) {
    if (item.kind === 'plain') placed.set(item.row.space.id, { repo: null, main: false })
    else for (const row of item.rows) placed.set(row.space.id, { repo: item.repo, main: row.main })
  }
  const counts = { needsYou: 0, working: 0 }
  // With words to match, the overlay lists flat results; with none (empty, or only state filters) it keeps the tree.
  const flat = terms.length > 0
  const hits = { worktrees: [] as Array<{ row: GoToRow; score: number; tier: number; latest: number; spaceId: string }>, tabs: [] as Array<{ row: GoToRow; score: number; rank: number; spaceId: string }> }
  const entries = input.spaces.flatMap((space) => {
    const own = input.tabs.filter((tab) => tab.spaceId === space.id)
    const worktreeOf = worktreeOfSpace(space, input.spaces)
    const where = placed.get(space.id) ?? { repo: null, main: false }
    const shown = rowName({ space, main: where.main })
    const repoLabel = where.repo ?? space.repoName ?? ''
    const scored = own.flatMap((tab) => {
      // A worktree is found by its repo's name too, so searching for a repo lists its worktrees with it.
      const fields = [tab.name, space.name, ...(worktreeOf ? [worktreeOf] : []), ...(tab.agent ? [AGENT_NAMES[tab.agent]] : [])]
      const score = terms.length > 0 ? queryScore(terms, fields) : 0
      if (score !== null) {
        if (tab.state === 'needs-you') counts.needsYou++
        else if (tab.state === 'working') counts.working++
      }
      if (states.size > 0 && !states.has(tab.state)) return []
      return score === null ? [] : [{ tab, score }]
    })
    if (flat) {
      const live = own.filter((tab) => !tab.exited)
      const rankOf = (tab: GoToTab) => URGENCY.indexOf(tab.state) * (input.recent.length + 1) + visitRank(input.recent, tab.id)
      const deciding = [...live].sort((a, b) => rankOf(a) - rankOf(b))[0]
      const spaceScore = queryScore(terms, [shown, space.name, ...(where.repo ? [where.repo] : [])])
      const eligible = (tab: GoToTab) => states.size === 0 || states.has(tab.state)
      const listed = spaceScore !== null && deciding !== undefined && live.some(eligible)
      if (listed) {
        const agents = live.filter((tab) => tab.agent !== null).length
        const label = BUSY.includes(deciding.state) ? indicatorLabel(deciding.state) : null
        const tier = own.some((tab) => tab.state === 'needs-you') ? 0 : own.some((tab) => tab.state === 'finished') ? 1 : space.id === input.activeSpaceId ? 2 : own.some((tab) => tab.state === 'working') ? 3 : 4
        const row: GoToRow = {
          ...rowOf(deciding),
          key: `space:${space.id}`,
          name: shown,
          state: mostUrgent(live.map((tab) => tab.state)) ?? 'idle',
          agent: null,
          agentName: null,
          stateLabel: label,
          matched: matchedOf(terms, shown),
          where: repoLabel,
          open: { agents, terminals: live.length - agents, agent: live.find((tab) => tab.agent !== null)?.agent ?? null },
        }
        hits.worktrees.push({ row, score: spaceScore, tier, latest: Math.min(...own.map((tab) => visitRank(input.recent, tab.id)), input.recent.length), spaceId: space.id })
      }
      for (const tab of own) {
        if (!eligible(tab)) continue
        const score = queryScore(terms, [tab.name, ...(tab.agent ? [AGENT_NAMES[tab.agent]] : [])])
        if (score === null) continue
        const row = { ...rowOf(tab), matched: matchedOf(terms, tab.name), where: [repoLabel, shown].filter((part, at, all) => part && all.indexOf(part) === at).join(' / ') }
        hits.tabs.push({ row, score, rank: rankOf(tab), spaceId: space.id })
      }
    }
    if (searching && scored.length === 0) return []
    scored.sort((a, b) => b.score - a.score || (searching ? 0 : urgency(a.tab.state) - urgency(b.tab.state)) || visitRank(input.recent, a.tab.id) - visitRank(input.recent, b.tab.id))
    const latest = Math.min(...own.map((tab) => visitRank(input.recent, tab.id)), input.recent.length)
    const tier = own.some((tab) => tab.state === 'needs-you') ? 0 : own.some((tab) => tab.state === 'finished') ? 1 : space.id === input.activeSpaceId ? 2 : own.some((tab) => tab.state === 'working') ? 3 : 4
    const top = scored[0]?.score ?? 0
    const rows = scored.map(({ tab }) => rowOf(tab))
    const live = own.filter((tab) => !tab.exited)
    const group = { spaceId: space.id, name: shown, repo: where.repo, state: mostUrgent(live.map((tab) => tab.state)) ?? 'idle', empty: live.length === 0, tabCount: own.length, single: own.length === 1, worktreeOf, rows }
    return [{ tier, latest, top, current: space.id === input.activeSpaceId, group }]
  })
  // Array.prototype.sort is stable, so spaces equally recent keep the sidebar order they came in.
  if (searching) entries.sort((a, b) => b.top - a.top || a.latest - b.latest)
  else entries.sort((a, b) => a.tier - b.tier || a.latest - b.latest)
  // A query searches every space, so only an empty one folds the quiet ones.
  const folded = searching ? { ids: new Set<string>(), last: null } : quietSpaces({ spaces: input.spaces, tabs: input.tabs, recent: input.recent, activeSpaceId: input.activeSpaceId })
  const quiet = entries.filter((entry) => folded.ids.has(entry.group.spaceId))
  const listed = quiet.length > 0 && !input.expandQuiet ? entries.filter((entry) => !quiet.includes(entry)) : entries
  // A heading holds its spaces together, where its first space in this order stands; the spaces keep that order within it.
  const ordered = listed.map((entry) => entry.group)
  const groups = ordered.filter((group, at) => group.repo === null || ordered.findIndex((other) => other.repo === group.repo) === at).flatMap((group) => (group.repo === null ? [group] : ordered.filter((other) => other.repo === group.repo)))
  let results: GoToView['results'] = null
  if (flat) {
    const sole = new Set(hits.worktrees.filter((hit) => input.tabs.filter((tab) => tab.spaceId === hit.spaceId).length === 1).map((hit) => hit.spaceId))
    results = {
      worktrees: hits.worktrees.sort((a, b) => b.score - a.score || a.tier - b.tier || a.latest - b.latest).map((hit) => hit.row),
      // A worktree with a single tab is already listed above as that tab.
      tabs: hits.tabs.filter((hit) => !sole.has(hit.spaceId)).sort((a, b) => b.score - a.score || a.rank - b.rank).map((hit) => hit.row),
    }
  }
  const rows = results ? [...results.worktrees, ...results.tabs] : groups.flatMap((group) => group.rows)
  const current = !searching ? rows.find((row) => row.tabId === input.activeTabId) : undefined
  const highlight = (current ?? rows[0])?.key ?? null
  return { groups, results, rows, counts, highlight, quiet: quiet.length > 0 ? { count: quiet.length, expanded: input.expandQuiet, last: entries.find((entry) => entry.group.spaceId === folded.last)?.group.name ?? null } : null }
}

// A tab with no name of its own: the program it runs and where, or for an agent its kind and "untitled", so it never reads as a bare number.
export function unnamedTabName(tab: { agent: AgentKind | null; foreground: string | null; cwd: string | null }, home: string): string {
  if (tab.agent) return `${tab.agent}, untitled`
  const where = tab.cwd ? shortFolder(tab.cwd, home) : ''
  return [tab.foreground ?? 'shell', where].filter(Boolean).join(' ')
}
