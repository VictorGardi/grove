// The state indicator: one small shape per agent state. Pure, so it runs in tests without a DOM.
// The shapes and colours are in styles.css (.ind-<state>); this file gives the names and labels.

export const INDICATOR_STATES = ['needs-you', 'working', 'finished', 'unknown', 'idle'] as const

export type IndicatorState = (typeof INDICATOR_STATES)[number]

const LABELS: Record<IndicatorState, string> = {
  'needs-you': 'needs you',
  working: 'working',
  finished: 'finished',
  unknown: 'unknown',
  idle: 'idle',
}

export function indicatorLabel(state: IndicatorState): string {
  return LABELS[state]
}

export function indicatorClass(state: IndicatorState): string {
  return `indicator ind-${state}`
}
