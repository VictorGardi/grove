import type { Session } from '@shared/types'
import { sandboxView } from '../../sessionStatus'
import { cx } from './cx'
import { Icon } from './Icon'
import s from './SandboxMark.module.css'

// What the sandbox actually is, since the mark itself only says the word (ADR 0034, ADR 0036): a
// Linux VM that sees the session's working directory and a fixed mount set, at the paths they have
// on the host, and nothing else of the machine. Network access is *not* restricted — so the label
// is the headline and this is the truth behind it.
const HINT = 'Runs in a Linux VM — the filesystem outside its working directory is not visible. Network access is unrestricted.'

// What the session lost, not what went wrong: the sandbox module collapses every failure to one
// outcome on purpose, so core cannot say which one it was and this must not pretend to know.
const LOST_HINT = 'Not sandboxed — the sandbox could not start when this session resumed, so its filesystem is not isolated.'

// Nothing at all when the session is unsandboxed and never was: the mark flags the exception, so
// labelling every unsandboxed session would spend the reader's attention on the common case. But a
// session that *was* confined and came back without it is the exception too (ADR 0033), and it gets
// its own mark — the danger tones are what keep it from reading as ordinary.
export function SandboxMark({ session, compact }: { session: Session; compact?: boolean }) {
  const view = sandboxView(session)
  if (view.state === 'none') return null
  const lost = view.state === 'lost'
  return (
    <span className={cx(s.mark, lost && s.lost, compact && s.compact)}
      title={lost ? LOST_HINT : HINT} aria-label={view.label}>
      <Icon name={lost ? 'shield-off' : 'shield'} size={12} />
      {compact ? null : <span>{view.label}</span>}
    </span>
  )
}
