// The rename modal: a name for one tab, or none (the tab shows "Tab N" again). Enter and Save save; Esc, Cancel and a click on
// the backdrop cancel. A save that fails keeps the modal open and says why inside it, so the reason is not hidden behind it.
export interface RenameTarget {
  id: string
  label: string | null
  number: number
}

export interface RenameElements {
  modal: HTMLElement
  form: HTMLFormElement
  input: HTMLInputElement
  cancel: HTMLButtonElement
  error: HTMLElement
}

export interface RenameDeps {
  rename(id: string, label: string): Promise<unknown>
  renamed(id: string, label: string): void
  closed(): void
}

export interface RenameModal {
  open(target: RenameTarget): void
  isOpen(): boolean
}

export function createRenameModal(elements: RenameElements, deps: RenameDeps): RenameModal {
  const { modal, form, input, cancel, error } = elements
  let target: RenameTarget | null = null

  function close(): void {
    target = null
    modal.hidden = true
    error.hidden = true
    error.textContent = ''
    deps.closed()
  }

  async function save(): Promise<void> {
    const current = target
    if (!current) return
    const label = input.value.trim()
    try {
      await deps.rename(current.id, label)
    } catch (failure) {
      if (target === current) {
        error.textContent = `Could not save the name: ${failure instanceof Error ? failure.message : String(failure)}`
        error.hidden = false
      }
      return
    }
    deps.renamed(current.id, label)
    if (target === current) close()
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void save()
  })
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close()
    // Enter in the name box saves here, not through the form's implicit submit, so it works the same in every browser.
    if (event.key === 'Enter' && event.target === input && !event.isComposing) {
      event.preventDefault()
      void save()
    }
  })
  cancel.addEventListener('click', close)
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close()
  })

  return {
    open(next) {
      target = next
      input.value = next.label ?? ''
      input.placeholder = String(next.number)
      error.hidden = true
      error.textContent = ''
      modal.hidden = false
      input.focus()
      input.select()
    },
    isOpen: () => target !== null,
  }
}
