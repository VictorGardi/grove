import type { CardState, Feature } from '@shared/types'
import type { StatusTone } from './components/ui/StatusDot'

export const CARD_STATE_LABELS: Record<CardState, string> = {
  backlog: 'Backlog',
  running: 'Running',
  waiting: 'Waiting',
  'needs-review': 'Needs review',
  ready: 'Ready',
  done: 'Done',
}

// The status-dot tone a feature card shows for its card state.
export const CARD_STATE_TONES: Record<CardState, StatusTone> = {
  backlog: 'idle',
  running: 'working',
  waiting: 'waiting',
  'needs-review': 'finished',
  ready: 'running',
  done: 'gone',
}

// Where a feature stands, without its card state (a session card shows its own status):
// "<current stage>", or "Done".
export function featureStage(f: Feature): string {
  return f.stages.find((s) => s.id === f.currentStage)?.label ?? 'Done'
}
