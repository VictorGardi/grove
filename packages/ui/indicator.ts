// The state indicator: one small shape per agent state. Pure, so it runs in tests without a DOM.
// The shapes and colours are in styles.css (.ind-<state>); this file gives the names and labels.

import type { AgentKind } from '../core/status/adapter.ts'

export const INDICATOR_STATES = ['needs-you', 'working', 'finished', 'unknown', 'idle'] as const

export type IndicatorState = (typeof INDICATOR_STATES)[number]

const AGENTS: Record<AgentKind, { name: string; minimumVersion: string }> = {
  claude: { name: 'Claude', minimumVersion: '2.1.309' },
  copilot: { name: 'Copilot', minimumVersion: '1.0.107' },
  opencode: { name: 'OpenCode', minimumVersion: '2.2.6' },
}

const LABELS: Record<IndicatorState, string> = {
  'needs-you': 'needs you',
  working: 'working',
  finished: 'finished',
  unknown: 'unknown',
  idle: 'idle',
}

export function indicatorLabel(state: IndicatorState, agent?: AgentKind, live = false): string {
  if (state === 'unknown' && agent && live) {
    const minimum = AGENTS[agent]
    return `no status report yet; requires ${minimum.name} ${minimum.minimumVersion} or later`
  }
  return LABELS[state]
}

export function indicatorClass(state: IndicatorState): string {
  return `indicator ind-${state}`
}
