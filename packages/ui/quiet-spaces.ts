// Which spaces are quiet, for every list that folds them (Go to today; the sidebar again in a later slice), so both fold the same ones.
// Plain functions, so they run in tests without a DOM.
import type { AgentStateName } from '../protocol/messages.ts'

// The states that have something for the human: an idle or unknown space has nothing to say.
export const BUSY: readonly AgentStateName[] = ['working', 'needs-you', 'finished']

// An idle space among this many most recently visited (besides the current one) is never quiet: its agent is usually waiting
// for the human's next prompt, which is the space they want to come back to.
export const RECENT_SPACES = 5

// How far back a tab was visited: 0 is the latest. A tab never visited is after all that were.
export function visitRank(recent: string[], tabId: string): number {
  const at = recent.indexOf(tabId)
  return at === -1 ? recent.length : at
}

// How far back a space was last visited: its most recently visited tab's rank, or `recent.length` when none ever was.
export function spaceLatest(recent: string[], tabIds: string[]): number {
  return Math.min(...tabIds.map((id) => visitRank(recent, id)), recent.length)
}

export interface QuietInput {
  // The spaces in the order the list shows them, each with the space it is a worktree of, if any.
  spaces: Array<{ id: string; parent: string | null }>
  // Every tab, with the state as it shows (a gone tab is idle).
  tabs: Array<{ id: string; spaceId: string; state: AgentStateName }>
  // Tab ids, most recently visited first.
  recent: string[]
  activeSpaceId: string | null
}

// The quiet spaces: not the current one or a worktree of it, nothing in them busy, and not among the RECENT_SPACES most
// recently visited (each space counts once, by its latest visit; the current space and its worktrees take no place).
// `last` is the quiet space visited most recently, null when none of them ever was.
export function quietSpaces(input: QuietInput): { ids: Set<string>; last: string | null } {
  const spaces = input.spaces.map(({ id, parent }) => {
    const own = input.tabs.filter((tab) => tab.spaceId === id)
    const inUse = id === input.activeSpaceId || (parent !== null && parent === input.activeSpaceId)
    return { id, inUse, latest: spaceLatest(input.recent, own.map((tab) => tab.id)), busy: own.some((tab) => BUSY.includes(tab.state)) }
  })
  const recent = new Set(
    spaces
      .filter((space) => !space.inUse && space.latest < input.recent.length)
      .sort((a, b) => a.latest - b.latest)
      .slice(0, RECENT_SPACES)
      .map((space) => space.id),
  )
  const quiet = spaces.filter((space) => !space.inUse && !space.busy && !recent.has(space.id))
  const last = quiet.reduce<(typeof quiet)[number] | null>((top, space) => (space.latest < input.recent.length && (!top || space.latest < top.latest) ? space : top), null)
  return { ids: new Set(quiet.map((space) => space.id)), last: last?.id ?? null }
}
