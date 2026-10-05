import type { CardState, Feature } from '@shared/types'

export const CARD_STATE_LABELS: Record<CardState, string> = {
  backlog: 'Backlog',
  running: 'Running',
  waiting: 'Waiting',
  'needs-review': 'Needs review',
  ready: 'Ready',
  done: 'Done',
}

// One line for a feature row: "<current stage> · <card state>", or "Done".
export function featureSummary(f: Feature): string {
  const stage = f.stages.find((s) => s.id === f.currentStage)
  return stage ? `${stage.label} · ${CARD_STATE_LABELS[f.cardState]}` : 'Done'
}
