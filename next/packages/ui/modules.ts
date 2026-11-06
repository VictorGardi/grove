// Window modules: a feature that lives in the dock. A module says what it is (a panel, its rail button, its key action) and which host
// events it follows; the window builds the buttons, the key bindings and the wiring from the list, so adding one is a file plus a line
// in the registry. The host (terminals, spaces, status, config, the dock itself) stays in main.ts. Built-in modules only.
import type { KeyAction } from '../protocol/messages.ts'
import type { Dock, DockPanel } from './dock.ts'
import { iconSvg, type IconName } from './icons.ts'

// What the host tells the modules. Delivery is synchronous, in the order modules subscribed.
export interface HostEvents {
  // The active tab, or what is shown of it, may have changed.
  activeTabChanged: undefined
  // A tab's agent changed state; `settled` is true when it just stopped working.
  agentStateChanged: { tabId: string; settled: boolean }
  // The connection to the core opened or closed.
  connectionChanged: { open: boolean }
}

export interface HostBus {
  on<K extends keyof HostEvents>(event: K, listener: (payload: HostEvents[K]) => void): void
  emit<K extends keyof HostEvents>(event: K, payload: HostEvents[K]): void
}

// A listener that throws is reported and skipped: one module cannot stop the others, or the window, from hearing the host.
export function createHostBus(report: (error: unknown) => void): HostBus {
  const listeners = new Map<string, Array<(payload: never) => void>>()
  return {
    on: (event, listener) => void listeners.set(event, [...(listeners.get(event) ?? []), listener]),
    emit: (event, payload) => {
      for (const listener of listeners.get(event) ?? []) {
        try {
          listener(payload as never)
        } catch (error) {
          report(error)
        }
      }
    },
  }
}

export interface DockModule {
  panel: DockPanel
  // The button on the rail that opens the panel.
  button: { icon: IconName; label: string | null; tooltip: string }
  // The key action that toggles the panel; its binding is the user's (keys.json).
  keyAction: KeyAction
  // Subscribe to the host events the module follows.
  follow?(bus: HostBus): void
}

export interface ModuleRail {
  // The toggle for a key action, or undefined when no module owns it.
  toggle(action: KeyAction): (() => void) | undefined
  // Writes each button's tooltip from the bindings in use.
  paintShortcuts(shortcut: (action: KeyAction) => string): void
}

// Builds the rail buttons, registers the panels and wires the events. A panel that fails to open is reported, not thrown.
export function mountModules(modules: readonly DockModule[], rail: HTMLElement, dock: Dock, bus: HostBus, report: (error: unknown) => void): ModuleRail & { pressed(id: string | null): void } {
  const buttons = new Map<DockModule, HTMLButtonElement>()
  const toggles = new Map<KeyAction, () => void>()
  for (const module of modules) {
    const id = module.panel.id
    const button = document.createElement('button')
    button.type = 'button'
    button.id = `${id}-toggle`
    button.className = `${module.button.label === null ? 'icon-pill' : 'pill'} dock-toggle`
    button.setAttribute('aria-pressed', 'false')
    if (module.button.label === null) button.setAttribute('aria-label', module.button.tooltip)
    button.innerHTML = iconSvg(module.button.icon) + (module.button.label ?? '')
    button.title = module.button.tooltip
    const toggle = (): void => void dock.toggle(id).catch(report)
    button.addEventListener('click', toggle)
    rail.append(button)
    buttons.set(module, button)
    toggles.set(module.keyAction, toggle)
    dock.register(module.panel)
    module.follow?.(bus)
  }
  return {
    toggle: (action) => toggles.get(action),
    pressed: (open) => {
      for (const [module, button] of buttons) button.setAttribute('aria-pressed', String(module.panel.id === open))
    },
    paintShortcuts: (shortcut) => {
      for (const [module, button] of buttons) button.title = `${module.button.tooltip} (${shortcut(module.keyAction)})`
    },
  }
}
