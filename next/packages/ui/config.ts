import { canonicalBinding } from '../core/config/schema.ts'
import type { KeyAction, Launcher, LayoutSection } from '../protocol/messages.ts'

// The part of an element the config code writes styles to. A DOM element satisfies it.
export interface StyleHost {
  style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>
}

// A key event as the window sees it. A KeyboardEvent satisfies it.
export interface KeyEvent {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export interface Binding {
  mod: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  key: string
}

// Sets the theme overrides as --<name> on the root and removes the ones no longer in the file. Returns the names now set.
export function applyTheme(root: StyleHost, tokens: Record<string, string>, previous: string[]): string[] {
  for (const name of previous) {
    if (!Object.hasOwn(tokens, name)) root.style.removeProperty(`--${name}`)
  }
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(`--${name}`, value)
  return Object.keys(tokens)
}

export function applySettings(root: StyleHost, settings: { sidebarWidth: number }): void {
  root.style.setProperty('--sidebar-width', `${settings.sidebarWidth}px`)
}

// Puts the sidebar sections in the given order before `before` (the footer). Sections not in `order` stay where they are.
export function applyLayout<T>(
  parent: { insertBefore(node: T, before: T | null): unknown },
  sections: Record<LayoutSection, T>,
  order: LayoutSection[],
  before: T | null,
): void {
  for (const name of order) parent.insertBefore(sections[name], before)
}

const quote = (word: string): string => `'${word.replace(/'/g, "'\\''")}'`

// The shell line a launcher types: `env K=V` only when it has variables, then the command and its arguments, every word single-quoted.
export function launcherLine(launcher: Launcher): string {
  const assignments = Object.entries(launcher.env).map(([name, value]) => `${name}=${value}`)
  const env = assignments.length > 0 ? ['env', ...assignments] : []
  return [...env, launcher.command, ...launcher.args].map(quote).join(' ')
}

// A key binding as text, such as "mod+shift+1", parsed into its modifiers and key. Null when the text is not a binding.
export function parseBinding(text: string): Binding | null {
  const canonical = canonicalBinding(text)
  if (canonical === null) return null
  const parts = canonical.split('+')
  return {
    mod: parts.includes('mod'),
    ctrl: parts.includes('ctrl'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
    key: parts.at(-1) ?? '',
  }
}

// The key pressed, by its physical code so Shift or Alt do not change it (Shift+1 is still "1").
function keyOf(event: KeyEvent): string {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5)
  return event.key.toLowerCase()
}

// A binding as the window shows it, such as "Cmd+Shift+N" on macOS or "Ctrl+Shift+N" elsewhere. Text that is not a binding is shown as it is.
export function formatBinding(text: string, isMac: boolean): string {
  const binding = parseBinding(text)
  if (binding === null) return text
  const names = [
    binding.mod ? (isMac ? 'Cmd' : 'Ctrl') : null,
    binding.ctrl ? 'Ctrl' : null,
    binding.alt ? (isMac ? 'Option' : 'Alt') : null,
    binding.shift ? 'Shift' : null,
  ]
  const key = binding.key.length === 1 ? binding.key.toUpperCase() : binding.key.charAt(0).toUpperCase() + binding.key.slice(1)
  return [...names.filter((name) => name !== null), key].join('+')
}

// "mod" is Cmd on macOS and Ctrl elsewhere; "ctrl" is the Control key everywhere. The modifiers must match exactly: a key that is down
// and not in the binding stops the match, so Cmd+B does not match Ctrl+B on macOS.
export function bindingMatches(binding: Binding, event: KeyEvent, isMac: boolean): boolean {
  const meta = binding.mod && isMac
  const ctrl = binding.ctrl || (binding.mod && !isMac)
  return (
    event.metaKey === meta &&
    event.ctrlKey === ctrl &&
    event.altKey === binding.alt &&
    event.shiftKey === binding.shift &&
    keyOf(event) === binding.key
  )
}

// The action whose binding the event matches, or null. Bindings are checked as the core validated them, so no two actions share one.
export function findAction(keys: Record<KeyAction, string>, event: KeyEvent, isMac: boolean): KeyAction | null {
  for (const action of Object.keys(keys) as KeyAction[]) {
    const binding = parseBinding(keys[action])
    if (binding !== null && bindingMatches(binding, event, isMac)) return action
  }
  return null
}
