// The Keys section of the settings: every key action with its binding. A click on a binding records the next key combination
// and asks the core to save it; the core says why when it refuses, and nothing changes then.
import { bindingFromEvent, formatBinding } from './config.ts'
import type { KeyAction } from '../protocol/messages.ts'

const SPACE_PLACES = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth']

export const KEY_LABELS: Record<KeyAction, string> = {
  'grid-toggle': 'Show or hide the grid',
  'new-shell': 'New shell tab',
  'new-space': 'New space at the home folder',
  'close-tab': 'Close the tab',
  'previous-tab': 'Previous tab',
  'grid-tab': 'Put the tab in the grid',
  'grid-reset-layout': 'Reset the grid layout',
  'next-urgent': 'Next tab that needs you, or is working',
  palette: 'Go to a tab',
  'sidebar-toggle': 'Show or hide the sidebar',
  notes: 'Notes',
  diff: 'Changes',
  'zoom-in': 'Zoom in',
  'zoom-out': 'Zoom out',
  'zoom-reset': 'Reset the zoom',
  'space-1': `Go to the ${SPACE_PLACES[0]} space`,
  'space-2': `Go to the ${SPACE_PLACES[1]} space`,
  'space-3': `Go to the ${SPACE_PLACES[2]} space`,
  'space-4': `Go to the ${SPACE_PLACES[3]} space`,
  'space-5': `Go to the ${SPACE_PLACES[4]} space`,
  'space-6': `Go to the ${SPACE_PLACES[5]} space`,
  'space-7': `Go to the ${SPACE_PLACES[6]} space`,
  'space-8': `Go to the ${SPACE_PLACES[7]} space`,
  'space-9': `Go to the ${SPACE_PLACES[8]} space`,
}

export interface KeysPanelDeps {
  keys: () => Record<KeyAction, string>
  defaults: Record<KeyAction, string>
  isMac: boolean
  save: (action: KeyAction, binding: string) => Promise<unknown>
}

export interface KeysPanel {
  // Draws the rows from the bindings in use. A recording in progress is dropped.
  render: () => void
}

function message(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

export function createKeysPanel(list: HTMLElement, error: HTMLElement, deps: KeysPanelDeps): KeysPanel {
  const showError = (text: string | null): void => {
    error.textContent = text ?? ''
    error.hidden = text === null
  }

  async function save(action: KeyAction, binding: string): Promise<void> {
    try {
      await deps.save(action, binding)
      showError(null)
    } catch (failure) {
      showError(`${KEY_LABELS[action]}: ${message(failure)}`)
    }
    render()
  }

  // The chip waits for one combination. Esc, or leaving the chip, gives up; a key that is not a binding yet (a modifier alone) is waited past.
  function record(chip: HTMLButtonElement, action: KeyAction): void {
    chip.textContent = 'Press keys…'
    chip.classList.add('recording')
    const stop = (): void => {
      chip.removeEventListener('keydown', onKey, true)
      chip.removeEventListener('blur', onBlur)
    }
    const onBlur = (): void => {
      stop()
      render()
    }
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault()
      // Esc must not also close the settings.
      event.stopPropagation()
      if (event.key === 'Escape') return onBlur()
      const binding = bindingFromEvent(event, deps.isMac)
      if (binding === null) {
        if (!['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) showError('Hold Cmd, Ctrl, Option or Shift with a letter, a digit, a period or Tab.')
        return
      }
      stop()
      if (binding === deps.keys()[action]) return render()
      void save(action, binding)
    }
    chip.addEventListener('keydown', onKey, true)
    chip.addEventListener('blur', onBlur)
  }

  function render(): void {
    const keys = deps.keys()
    list.replaceChildren(
      ...(Object.keys(KEY_LABELS) as KeyAction[]).map((action) => {
        const row = document.createElement('li')
        row.className = 'keys-row'
        const label = document.createElement('span')
        label.className = 'keys-label'
        label.textContent = KEY_LABELS[action]
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'keys-chip'
        chip.dataset.action = action
        chip.textContent = formatBinding(keys[action], deps.isMac)
        chip.title = 'Click, then press the new keys'
        chip.addEventListener('click', () => {
          showError(null)
          record(chip, action)
        })
        row.append(label, chip)
        if (keys[action] !== deps.defaults[action]) {
          const reset = document.createElement('button')
          reset.type = 'button'
          reset.className = 'keys-reset'
          reset.dataset.action = action
          reset.textContent = 'Reset'
          reset.title = `Back to ${formatBinding(deps.defaults[action], deps.isMac)}`
          reset.addEventListener('click', () => void save(action, deps.defaults[action]))
          row.append(reset)
        }
        return row
      }),
    )
  }

  return { render }
}
