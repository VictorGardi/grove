import type { SessionKind } from '@shared/types'
import { sandboxable, wantsSandbox } from '../sandboxOptIn'
import { Icon } from './ui/Icon'
import { Switch } from './ui/Switch'
import { cx } from './ui/cx'
import s from './SandboxToggle.module.css'

// The ⌘T palette's trailing control: what it is (the same shield a confined session wears), what it
// is called, and the switch. The word is written out rather than left to a tooltip, for the reason
// ADR 0036 gives for the launch form — a tooltip is read after the choice, not before it, and this
// choice is the one that decides what the agent can reach.
export function SandboxToggle({ kind, checked, onChange }: {
  kind: SessionKind
  checked: boolean
  onChange: (next: boolean) => void
}) {
  // A terminal has no agent argv to wrap, so the switch is offered and refused rather than hidden:
  // a gap in the row where a control should be reads as a layout bug, and the reason belongs in the
  // control that cannot be used.
  const can = sandboxable(kind)
  // What this row will actually get, from the same function that decides what core is sent — so the
  // switch cannot read "on" for a session that will come back on the host because the toggle was
  // left on for the row above it. The choice is still armed; it just does not reach a terminal.
  const on = wantsSandbox(kind, checked)
  return (
    // The row underneath commits the launch on click, so the whole toggle — knob, shield and word —
    // swallows its own clicks. Stopping it here rather than on the Switch keeps one rule for the
    // three elements instead of one rule per element.
    <span className={cx(s.toggle, !can && s.off)} onClick={(e) => e.stopPropagation()}>
      <Icon name="shield" size={13} />
      <span className={s.word}>Sandbox</span>
      <Switch
        checked={on}
        disabled={!can}
        onChange={onChange}
        label={can ? 'Run this session in a sandbox' : 'A terminal session has no agent to put in a sandbox'}
      />
    </span>
  )
}