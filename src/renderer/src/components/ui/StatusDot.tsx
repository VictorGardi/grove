import { cx } from './cx'
import s from './StatusDot.module.css'

export type StatusTone = 'running' | 'working' | 'waiting' | 'idle' | 'finished' | 'gone'

export function StatusDot({ tone }: { tone: StatusTone }) {
  return <span className={cx(s.dot, s[tone])} />
}
