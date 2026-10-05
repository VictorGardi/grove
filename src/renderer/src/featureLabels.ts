import type { CardState, Feature } from '@shared/types'

export const CARD_STATE_LABELS: Record<CardState, string> = {
  backlog: 'Backlog',
  running: 'Running',
  waiting: 'Waiting',
  'needs-review': 'Needs review',
  ready: 'Ready',
  active: 'Active',
  done: 'Done',
}

export const progressLabel = (f: Feature) => (f.progress ? `${f.progress.done} / ${f.progress.total} done` : '')

// Where a feature stands, without its card state (a session card shows its own status):
// "<current stage>", "n / m done" for an active group, or "Done".
export function featureStage(f: Feature): string {
  if (f.cardState === 'active') return progressLabel(f)
  return f.stages.find((s) => s.id === f.currentStage)?.label ?? 'Done'
}

// One line for a feature row: "<current stage> · <card state>", "Active · n / m done", or "Done".
export function featureSummary(f: Feature): string {
  if (f.cardState === 'active') return `${CARD_STATE_LABELS.active} · ${progressLabel(f)}`
  const stage = f.stages.find((s) => s.id === f.currentStage)
  return stage ? `${stage.label} · ${CARD_STATE_LABELS[f.cardState]}` : 'Done'
}
