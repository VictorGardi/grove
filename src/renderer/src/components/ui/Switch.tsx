import { cx } from './cx'
import s from './Switch.module.css'

// The one switch, shared by both places a sandbox can be asked for: the ⌘T palette's trailing
// control and the ⌘⇧T launch form's isolation row. A component rather than a class because two
// copies of this markup would drift the first time either was touched, and a sandbox that looked
// like two different settings would be worse than either one looking like the other.
export function Switch({ checked, onChange, disabled, label }: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  // Spoken, not hovered: the visible text beside this control says what it is, and a tooltip is
  // the one place a reader looks after they have already chosen (ADR 0036).
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx(s.switch, checked && s.on)}
      onClick={() => onChange(!checked)}
    />
  )
}