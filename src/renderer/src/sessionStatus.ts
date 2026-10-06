import type { Session } from '@shared/types'
import type { StatusTone } from './components/ui/StatusDot'

export type ShownStatus = 'running' | 'gone' | 'working' | 'waiting' | 'idle'

// gone (tmux) wins; else the live OpenCode status; else tmux running (terminals, or no service).
export function shownStatus(s: Session): ShownStatus {
  if (s.lastStatus === 'gone') return 'gone'
  return s.status ?? 'running'
}

export function statusView(s: Session): { label: string; tone: StatusTone } {
  const shown = shownStatus(s)
  return { label: shown, tone: shown }
}
