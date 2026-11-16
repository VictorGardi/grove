// The built-in dock modules. Each is a panel, its rail button, its key action and the host events it follows.
import { createDiffPanel, type DiffDeps } from './diff-panel.ts'
import type { DockModule } from './modules.ts'
import { createNotesPanel, type NotesDeps } from './notes-panel.ts'
import { createUsagePanel, type UsageDeps } from './usage-panel.ts'

export function notesModule(deps: NotesDeps): DockModule {
  return {
    panel: createNotesPanel(deps),
    button: { icon: 'notes', label: null, tooltip: 'Notes' },
    keyAction: 'notes',
  }
}

// The changes panel shows the active tab's folder. It names the tab and the core finds the folder; it asks again on the host events below,
// the core never pushes.
export function diffModule(deps: DiffDeps): DockModule {
  const diff = createDiffPanel(deps)
  return {
    panel: diff.panel,
    button: { icon: 'diff', label: null, tooltip: 'Changes' },
    keyAction: 'diff',
    follow: (bus) => {
      bus.on('activeTabChanged', () => diff.retarget())
      bus.on('agentStateChanged', ({ tabId, settled }) => diff.agentChanged(tabId, settled))
      bus.on('connectionChanged', ({ open }) => diff.connection(open))
    },
  }
}

// The usage panel shows the core's saved usage history. It asks again when the core says the numbers changed (`changed`, wired to the
// usage.changed notification), when the connection comes back, and when an agent stops working.
export function usageModule(deps: UsageDeps): DockModule & { changed(): void } {
  const usage = createUsagePanel(deps)
  return {
    panel: usage.panel,
    button: { icon: 'usage', label: null, tooltip: 'Usage' },
    keyAction: 'usage',
    changed: () => usage.refresh(),
    follow: (bus) => {
      bus.on('agentStateChanged', ({ settled }) => {
        if (settled) usage.refresh()
      })
      bus.on('connectionChanged', ({ open }) => usage.connection(open))
    },
  }
}
