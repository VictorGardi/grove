import { describe, expect, it } from 'vitest'
import type { KeyAction, Launcher, LayoutSection } from '../protocol/messages.ts'
import { DEFAULT_VALUES } from '../core/config/schema.ts'
import {
  applyLayout,
  applySettings,
  applyTheme,
  bindingMatches,
  findAction,
  formatBinding,
  launcherLine,
  parseBinding,
  type KeyEvent,
  type StyleHost,
} from './config.ts'

// A style host that records the custom properties set on it, as the DOM would.
function fakeRoot(): StyleHost & { props: Map<string, string> } {
  const props = new Map<string, string>()
  return {
    props,
    style: {
      setProperty: (name: string, value: string) => void props.set(name, value),
      removeProperty: (name: string) => {
        props.delete(name)
        return ''
      },
    } as StyleHost['style'],
  }
}

function keyEvent(overrides: Partial<KeyEvent>): KeyEvent {
  return { key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides }
}

const launcher = (overrides: Partial<Launcher>): Launcher => ({
  id: 'plan',
  label: 'Plan',
  command: 'claude',
  args: [],
  env: {},
  ...overrides,
})

describe('applyTheme', () => {
  it('sets each token as a custom property and returns the names now set', () => {
    const root = fakeRoot()
    const names = applyTheme(root, { accent: '#00ff00', 'radius-md': '8px' }, [])
    expect(root.props.get('--accent')).toBe('#00ff00')
    expect(root.props.get('--radius-md')).toBe('8px')
    expect(names).toEqual(['accent', 'radius-md'])
  })

  it('removes a token that is no longer in the file so it reverts to its default', () => {
    const root = fakeRoot()
    const names = applyTheme(root, { accent: '#00ff00', 'font-ui': 'serif' }, [])
    const later = applyTheme(root, { 'font-ui': 'serif' }, names)
    expect(later).toEqual(['font-ui'])
    expect(root.props.has('--accent')).toBe(false)
    expect(root.props.get('--font-ui')).toBe('serif')
  })
})

describe('applySettings', () => {
  it('sets the sidebar width in pixels', () => {
    const root = fakeRoot()
    applySettings(root, { sidebarWidth: 300 })
    expect(root.props.get('--sidebar-width')).toBe('300px')
  })
})

describe('applyLayout', () => {
  // A parent that keeps its children in order, as the sidebar does.
  function sidebar(children: string[]) {
    return {
      children,
      insertBefore(node: string, before: string | null) {
        this.children.splice(this.children.indexOf(node), 1)
        const index = before === null ? this.children.length : this.children.indexOf(before)
        this.children.splice(index, 0, node)
      },
    }
  }
  const sections = { spaces: 'section-spaces', agents: 'section-agents' } satisfies Record<LayoutSection, string>

  it('keeps the default order when the order lists spaces first', () => {
    const parent = sidebar(['section-spaces', 'section-agents', 'footer'])
    applyLayout(parent, sections, ['spaces', 'agents'], 'footer')
    expect(parent.children).toEqual(['section-spaces', 'section-agents', 'footer'])
  })

  it('puts agents above spaces and keeps the footer last', () => {
    const parent = sidebar(['section-spaces', 'section-agents', 'footer'])
    applyLayout(parent, sections, ['agents', 'spaces'], 'footer')
    expect(parent.children).toEqual(['section-agents', 'section-spaces', 'footer'])
  })

  it('appends to the end when there is no footer', () => {
    const parent = sidebar(['section-agents', 'section-spaces'])
    applyLayout(parent, sections, ['spaces', 'agents'], null)
    expect(parent.children).toEqual(['section-spaces', 'section-agents'])
  })
})

describe('launcherLine', () => {
  it('types the command and its arguments, each single-quoted', () => {
    expect(launcherLine(launcher({ args: ['plan'] }))).toBe(`'claude' 'plan'`)
  })

  it('quotes an argument with a space and a quote so the shell reads it as one word', () => {
    const line = launcherLine(launcher({ args: ['fix the "bug", it\'s done'] }))
    expect(line).toBe(`'claude' 'fix the "bug", it'\\''s done'`)
  })

  it('prefixes env K=V only when the launcher has variables', () => {
    expect(launcherLine(launcher({ env: { MODE: 'plan', DEBUG: '1' }, args: ['x'] }))).toBe(
      `'env' 'MODE=plan' 'DEBUG=1' 'claude' 'x'`,
    )
    expect(launcherLine(launcher({ env: {} }))).not.toContain('env')
  })
})

describe('parseBinding', () => {
  it('reads the modifiers and the key of a canonical or reordered binding', () => {
    expect(parseBinding('mod+shift+1')).toEqual({ mod: true, ctrl: false, alt: false, shift: true, key: '1' })
    expect(parseBinding('shift+alt+mod+g')).toEqual({ mod: true, ctrl: false, alt: true, shift: true, key: 'g' })
    expect(parseBinding('ctrl+tab')).toEqual({ mod: false, ctrl: true, alt: false, shift: false, key: 'tab' })
  })

  it('returns null for text that is not a binding', () => {
    expect(parseBinding('g')).toBeNull()
    expect(parseBinding('mod+Enter')).toBeNull()
    expect(parseBinding('mod+mod+g')).toBeNull()
  })
})

describe('bindingMatches', () => {
  const grid = parseBinding('mod+g')!

  it('matches Cmd+G on macOS and not Ctrl+G', () => {
    expect(bindingMatches(grid, keyEvent({ key: 'g', code: 'KeyG', metaKey: true }), true)).toBe(true)
    expect(bindingMatches(grid, keyEvent({ key: 'g', code: 'KeyG', ctrlKey: true }), true)).toBe(false)
  })

  it('matches Ctrl+G on other platforms and not Cmd+G', () => {
    expect(bindingMatches(grid, keyEvent({ key: 'g', code: 'KeyG', ctrlKey: true }), false)).toBe(true)
    expect(bindingMatches(grid, keyEvent({ key: 'g', code: 'KeyG', metaKey: true }), false)).toBe(false)
  })

  it('needs the exact modifiers, so an extra Shift or Alt does not match', () => {
    expect(bindingMatches(grid, keyEvent({ key: 'G', code: 'KeyG', metaKey: true, shiftKey: true }), true)).toBe(false)
    expect(bindingMatches(grid, keyEvent({ key: 'g', code: 'KeyG', metaKey: true, altKey: true }), true)).toBe(false)
  })

  it('matches a digit by its code, so Shift+1 (key "!") matches mod+shift+1', () => {
    const claude = parseBinding('mod+shift+1')!
    expect(bindingMatches(claude, keyEvent({ key: '!', code: 'Digit1', metaKey: true, shiftKey: true }), true)).toBe(true)
  })

  it('does not match when the other command key is also down', () => {
    expect(bindingMatches(grid, keyEvent({ key: 'g', code: 'KeyG', metaKey: true, ctrlKey: true }), true)).toBe(false)
  })

  it('matches ctrl+tab on every platform, and only with Control down', () => {
    const previous = parseBinding('ctrl+tab')!
    const tab = { key: 'Tab', code: 'Tab' }
    expect(bindingMatches(previous, keyEvent({ ...tab, ctrlKey: true }), true)).toBe(true)
    expect(bindingMatches(previous, keyEvent({ ...tab, ctrlKey: true }), false)).toBe(true)
    expect(bindingMatches(previous, keyEvent({ ...tab }), true)).toBe(false)
    expect(bindingMatches(previous, keyEvent({ ...tab, ctrlKey: true, shiftKey: true }), true)).toBe(false)
    expect(bindingMatches(previous, keyEvent({ ...tab, ctrlKey: true, metaKey: true }), true)).toBe(false)
  })

  it('keeps Cmd and Ctrl apart on macOS: mod+b does not match Ctrl+B', () => {
    const sidebar = parseBinding('mod+b')!
    expect(bindingMatches(sidebar, keyEvent({ key: 'b', code: 'KeyB', ctrlKey: true }), true)).toBe(false)
    expect(bindingMatches(sidebar, keyEvent({ key: 'b', code: 'KeyB', metaKey: true }), true)).toBe(true)
  })
})

describe('formatBinding', () => {
  it('names the keys the way the window shows them, with Cmd on macOS and Ctrl elsewhere', () => {
    expect(formatBinding('mod+shift+n', true)).toBe('Cmd+Shift+N')
    expect(formatBinding('mod+shift+n', false)).toBe('Ctrl+Shift+N')
    expect(formatBinding('ctrl+tab', true)).toBe('Ctrl+Tab')
    expect(formatBinding('mod+1', true)).toBe('Cmd+1')
  })
})

describe('findAction', () => {
  const keys: Record<KeyAction, string> = DEFAULT_VALUES.keys

  it('returns the action of the matching binding, or null', () => {
    expect(findAction(keys, keyEvent({ key: 't', code: 'KeyT', ctrlKey: true }), false)).toBe('new-shell')
    expect(findAction(keys, keyEvent({ key: 'N', code: 'KeyN', metaKey: true, shiftKey: true }), true)).toBe('new-space')
    expect(findAction(keys, keyEvent({ key: 'w', code: 'KeyW', metaKey: true }), true)).toBe('close-tab')
    expect(findAction(keys, keyEvent({ key: 'x', code: 'KeyX', metaKey: true }), true)).toBeNull()
    expect(findAction(keys, keyEvent({ key: 'Tab', code: 'Tab', ctrlKey: true }), false)).toBe('previous-tab')
    expect(findAction(keys, keyEvent({ key: 'G', code: 'KeyG', metaKey: true, shiftKey: true }), true)).toBe('grid-tab')
    expect(findAction(keys, keyEvent({ key: 'b', code: 'KeyB', metaKey: true }), true)).toBe('sidebar-toggle')
    expect(findAction(keys, keyEvent({ key: '7', code: 'Digit7', metaKey: true }), true)).toBe('space-7')
  })

  it('follows a rebound key and ignores the old one', () => {
    const rebound = { ...keys, 'grid-toggle': 'alt+v' }
    expect(findAction(rebound, keyEvent({ key: 'v', code: 'KeyV', altKey: true }), true)).toBe('grid-toggle')
    expect(findAction(rebound, keyEvent({ key: 'g', code: 'KeyG', metaKey: true }), true)).toBeNull()
  })
})
