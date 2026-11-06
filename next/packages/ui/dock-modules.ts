// The built-in dock modules. Each is a panel, its rail button, its key action and the host events it follows.
import { createDiffPanel, type DiffDeps } from './diff-panel.ts'
import type { DockModule } from './modules.ts'
import { createNotesPanel, type NotesDeps } from './notes-panel.ts'

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
    button: { icon: 'diff', label: 'Changes', tooltip: 'Changes' },
    keyAction: 'diff',
    follow: (bus) => {
      bus.on('activeTabChanged', () => diff.retarget())
      bus.on('agentStateChanged', ({ tabId, settled }) => diff.agentChanged(tabId, settled))
      bus.on('connectionChanged', ({ open }) => diff.connection(open))
    },
  }
}
