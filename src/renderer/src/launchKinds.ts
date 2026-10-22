import type { SessionKind } from '@shared/types'
import type { IconName } from './components/ui/Icon'

// The kinds the new-session dialog and the ⌘T palette offer, in display order. Copilot is third and
// Terminal fourth, but ⌥ shortcuts keep their original numbers (1 Claude, 2 OpenCode, 3 Terminal) and
// Copilot takes 4, so a habit formed before Copilot existed still opens what it used to.
export const LAUNCH_KINDS: { kind: SessionKind; label: string; icon: IconName; code: string; key: string }[] = [
  { kind: 'claude', label: 'Claude Code', icon: 'claude', code: 'Digit1', key: '1' },
  { kind: 'opencode', label: 'OpenCode', icon: 'opencode', code: 'Digit2', key: '2' },
  { kind: 'copilot', label: 'Copilot', icon: 'copilot', code: 'Digit4', key: '4' },
  { kind: 'terminal', label: 'Terminal', icon: 'terminal', code: 'Digit3', key: '3' },
]
