// One dialog for the space actions: a title and a line of text, then an input (a name), a list (a choice) or nothing (a
// question), with the primary action's label. Enter does the primary action and Esc cancels. When the action fails the dialog stays
// open and says why inside it, so the reason is not hidden behind it. The dialog is built when it opens and removed when it closes.
export interface DialogSpec {
  title: string
  text?: string
  input?: { placeholder: string; value?: string }
  // A list to pick from; picking one does the action with its value at once. `empty` is the line shown when the list is empty.
  choices?: { label: string; detail?: string; value: string }[]
  empty?: string
  // The primary button's label; none for a pick, which has only the list and Cancel.
  confirm?: string
  // The text beside Esc in the hint under an input, such as "create".
  hint?: string
  // The cancel button's label; "Cancel" by default.
  cancel?: string
  // A destructive question: Cancel has the focus, so a stray Enter does nothing.
  danger?: boolean
  // The input's text, the chosen value, or an empty string for a question. A rejection is shown inside the dialog.
  submit(value: string): Promise<unknown>
}

export interface SpaceDialog {
  open(spec: DialogSpec): Promise<boolean>
  isOpen(): boolean
}

export function createSpaceDialog(host: HTMLElement): SpaceDialog {
  let current: HTMLElement | null = null

  return {
    isOpen: () => current !== null,
    open(spec) {
      return new Promise<boolean>((resolve) => {
        const backdrop = document.createElement('div')
        backdrop.className = 'modal-backdrop'
        const form = document.createElement('form')
        form.className = 'modal'
        form.setAttribute('role', 'dialog')
        form.setAttribute('aria-modal', 'true')
        const title = document.createElement('h2')
        title.className = 'modal-title'
        title.textContent = spec.title
        form.append(title)
        if (spec.text) {
          const text = document.createElement('p')
          text.className = 'modal-text'
          text.textContent = spec.text
          form.append(text)
        }
        let input: HTMLInputElement | null = null
        if (spec.input) {
          input = document.createElement('input')
          input.className = 'modal-input'
          input.type = 'text'
          input.spellcheck = false
          input.placeholder = spec.input.placeholder
          input.value = spec.input.value ?? ''
          input.setAttribute('aria-label', spec.title)
          form.append(input)
        }
        const choiceButtons: HTMLButtonElement[] = []
        if (spec.choices) {
          const list = document.createElement('ul')
          list.className = 'dialog-choices'
          for (const choice of spec.choices) {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'dialog-choice'
            const label = document.createElement('span')
            label.textContent = choice.label
            const detail = document.createElement('span')
            detail.className = 'dialog-choice-detail'
            detail.textContent = choice.detail ?? ''
            button.append(label, detail)
            button.addEventListener('click', () => void run(choice.value))
            const item = document.createElement('li')
            item.append(button)
            list.append(item)
            choiceButtons.push(button)
          }
          form.append(list)
          if (spec.choices.length === 0 && spec.empty) {
            const empty = document.createElement('p')
            empty.className = 'modal-text'
            empty.textContent = spec.empty
            form.append(empty)
          }
        }
        const error = document.createElement('p')
        error.className = 'modal-error'
        error.setAttribute('role', 'alert')
        error.hidden = true
        const actions = document.createElement('div')
        actions.className = 'modal-actions'
        if (spec.input && spec.hint) {
          const hint = document.createElement('span')
          hint.className = 'modal-hint'
          hint.textContent = `↵ ${spec.hint} · esc cancel`
          actions.append(hint)
        }
        const cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.textContent = spec.cancel ?? (spec.confirm ? 'Cancel' : 'Close')
        actions.append(cancel)
        let primary: HTMLButtonElement | null = null
        if (spec.confirm) {
          primary = document.createElement('button')
          primary.type = 'submit'
          primary.className = 'modal-save'
          primary.textContent = spec.confirm
          actions.append(primary)
        }
        form.append(error, actions)
        backdrop.append(form)

        let busy = false
        function finish(done: boolean): void {
          backdrop.remove()
          current = null
          resolve(done)
        }
        async function run(value: string): Promise<void> {
          if (busy) return
          busy = true
          error.hidden = true
          try {
            await spec.submit(value)
          } catch (failure) {
            error.textContent = failure instanceof Error ? failure.message : String(failure)
            error.hidden = false
            busy = false
            return
          }
          finish(true)
        }
        form.addEventListener('submit', (event) => {
          event.preventDefault()
          if (spec.confirm) void run(input ? input.value.trim() : '')
        })
        form.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            finish(false)
          }
        })
        cancel.addEventListener('click', () => finish(false))
        backdrop.addEventListener('click', (event) => {
          if (event.target === backdrop) finish(false)
        })

        current?.remove()
        current = backdrop
        host.append(backdrop)
        if (input) {
          input.focus()
          input.select()
        } else if (spec.danger || !primary) (choiceButtons[0] ?? cancel).focus()
        else primary.focus()
      })
    },
  }
}
