import type { AgentStateName } from './messages.ts'

// Most urgent first. The sidebar orders agent rows and rolls a space's tabs up by this order.
export const URGENCY: readonly AgentStateName[] = ['needs-you', 'working', 'finished', 'unknown', 'idle']

// The most urgent of the states. No states at all is idle.
export function mostUrgent(states: Iterable<AgentStateName>): AgentStateName {
  let winner: AgentStateName = 'idle'
  for (const state of states) {
    if (URGENCY.indexOf(state) < URGENCY.indexOf(winner)) winner = state
  }
  return winner
}

// Each space id gets the most urgent state among the tabs whose spaceId is exactly that id.
// Two spaces at one folder roll up separately; a worktree's tabs count only towards the worktree; a space with no tabs is idle.
export function rollupSpaces(
  spaceIds: string[],
  tabs: Array<{ spaceId: string; state: AgentStateName }>,
): Map<string, AgentStateName> {
  const bySpace = new Map<string, AgentStateName[]>()
  for (const tab of tabs) {
    bySpace.set(tab.spaceId, [...(bySpace.get(tab.spaceId) ?? []), tab.state])
  }
  return new Map(spaceIds.map((spaceId) => [spaceId, mostUrgent(bySpace.get(spaceId) ?? [])]))
}
