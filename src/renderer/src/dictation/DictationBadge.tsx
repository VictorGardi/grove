import s from './DictationBadge.module.css'

export function DictationBadge({ phase }: { phase: 'listening' | 'transcribing' }) {
  return <div className={s.badge} role="status">{phase === 'listening' ? 'Listening' : 'Transcribing'}</div>
}
