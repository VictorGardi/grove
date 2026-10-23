import { cx } from './cx'
import { Spinner } from './Spinner'
import s from './StatusDot.module.css'

export type StatusTone = 'running' | 'working' | 'waiting' | 'idle' | 'finished' | 'gone' | 'starting'

export function StatusDot({ tone }: { tone: StatusTone }) {
  if (tone === 'starting') return <Spinner size="sm" label="Starting" />
  return <span className={cx(s.dot, s[tone])} />
}
