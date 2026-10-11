import { cx } from './cx'
import { Icon } from './Icon'
import s from './SandboxMark.module.css'

// What the sandbox actually is, since the mark itself only says the word (ADR 0034, ADR 0036): a
// Linux VM that sees the session's working directory and a fixed mount set, at the paths they have
// on the host, and nothing else of the machine. Network access is *not* restricted — so the label
// is the headline and this is the truth behind it.
const HINT = 'Runs in a Linux VM — the filesystem outside its working directory is not visible. Network access is unrestricted.'

// Nothing at all when the session is unsandboxed: the mark flags the exception, so labelling every
// unsandboxed session would spend the reader's attention on the common case.
export function SandboxMark({ sandboxed, compact }: { sandboxed: boolean; compact?: boolean }) {
  if (!sandboxed) return null
  return (
    <span className={cx(s.mark, compact && s.compact)} title={HINT} aria-label="Sandboxed">
      <Icon name="shield" size={12} />
      {compact ? null : <span>Sandboxed</span>}
    </span>
  )
}