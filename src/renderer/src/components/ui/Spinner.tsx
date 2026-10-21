import s from './Spinner.module.css'

// A ring that turns in the current text colour: for work the human is waiting on, such as a git
// call that takes a couple of seconds and would otherwise leave the screen looking stuck.
export function Spinner() {
  return <span className={s.spinner} role="status" aria-label="Working" />
}
