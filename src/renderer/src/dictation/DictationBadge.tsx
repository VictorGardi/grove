import s from './DictationBadge.module.css'
import { dictationMessage, type DictationState } from './machine'

export function DictationBadge({ state }: { state: Exclude<DictationState, { phase: 'idle' }> }) {
  const error = state.phase === 'error'
  const text = state.phase === 'listening' ? 'Listening' : state.phase === 'transcribing' ? 'Transcribing' : dictationMessage(state.kind)
  return <div className={error ? `${s.badge} ${s.error}` : s.badge} role="status">{text}</div>
}
