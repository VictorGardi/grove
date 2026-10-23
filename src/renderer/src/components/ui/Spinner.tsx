import { cx } from './cx'
import s from './Spinner.module.css'

// A ring that turns in the current text colour: for work the human is waiting on, such as a git
// call that takes a couple of seconds and would otherwise leave the screen looking stuck.
// `sm` is the size of a status dot, for a session that has not reported a status yet.
export function Spinner({ size, label = 'Working' }: { size?: 'sm'; label?: string }) {
  return <span className={cx(s.spinner, size === 'sm' && s.sm)} role="status" aria-label={label} />
}
