// The notes panel: one markdown page, saved as you type. It saves a moment after the last key, when the window loses focus, and when the
// panel closes, so a reload or a quit loses at most that moment. The editor is mounted only once the page has loaded, so a failed read can
// never be saved over the notes. A close whose save fails keeps the panel open and says why; closing again discards the unsaved text.
import type { DockContext, DockInstance, DockPanel } from './dock.ts'

export const SAVE_DELAY_MS = 400

export interface NotesEditorHandle {
  focus(): void
  destroy(): void
}

export interface NotesDeps {
  read(): Promise<string>
  write(text: string): Promise<unknown>
  createEditor(
    host: HTMLElement,
    text: string,
    handlers: { onChange(text: string): void; onSave(): void; onClose(): void },
  ): NotesEditorHandle
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
}

export function createNotesPanel(deps: NotesDeps): DockPanel {
  return {
    id: 'notes',
    title: 'Notes',
    mount: (body, context) => mountNotes(body, context, deps),
  }
}

function mountNotes(body: HTMLElement, context: DockContext, deps: NotesDeps): DockInstance {
  const host = document.createElement('div')
  host.className = 'notes-editor'
  body.append(host)

  let editor: NotesEditorHandle | null = null
  let text: string | null = null // the latest text; null until the page has loaded
  let saved: string | null = null // the text the file holds, as far as this window knows
  let timer: ReturnType<typeof setTimeout> | null = null
  let writing: Promise<boolean> | null = null
  let lastError = ''
  let failedClose = false
  let destroyed = false

  function paint(): void {
    if (text === null) context.status('')
    else context.status(text !== saved ? (writing ? 'Saving…' : 'Unsaved') : 'Saved')
    context.meta(text === null ? '' : `${countWords(text)} words`)
  }

  function fail(message: string): void {
    lastError = message
    context.error(message)
  }

  // Writes the latest text. Writes never overlap: one that arrives during a write waits for it and then writes whatever is latest.
  async function flush(): Promise<boolean> {
    if (timer) clearTimeout(timer)
    timer = null
    while (writing) await writing
    if (text === null || text === saved) return true
    const sent = text
    writing = (async () => {
      try {
        await deps.write(sent)
        saved = sent
        context.error(null)
        return true
      } catch (failure) {
        fail(`Could not save the notes: ${failure instanceof Error ? failure.message : String(failure)}`)
        return false
      }
    })()
    paint()
    const ok = await writing
    writing = null
    if (!destroyed) paint()
    if (ok && text !== saved) return flush()
    return ok
  }

  const onHidden = (): void => {
    if (document.hidden) void flush()
  }
  const onBlur = (): void => void flush()
  document.addEventListener('visibilitychange', onHidden)
  window.addEventListener('blur', onBlur)

  context.status('Loading…')
  deps.read().then(
    (loaded) => {
      if (destroyed) return
      text = loaded
      saved = loaded
      paint()
      editor = deps.createEditor(host, loaded, {
        onChange: (next) => {
          text = next
          failedClose = false
          paint()
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => void flush(), SAVE_DELAY_MS)
        },
        onSave: () => void flush(),
        onClose: () => context.close(),
      })
      editor.focus()
    },
    (failure: unknown) => {
      if (destroyed) return
      context.status('')
      fail(`Could not load the notes: ${failure instanceof Error ? failure.message : String(failure)}`)
      failedClose = true // nothing was loaded, so there is nothing to lose: the next close just closes
    },
  )

  return {
    focus: () => editor?.focus(),
    async canClose() {
      if (failedClose) return true
      if (await flush()) return true
      failedClose = true
      context.error(`${lastError} Close again to discard the unsaved text.`)
      return false
    },
    destroy() {
      destroyed = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('blur', onBlur)
      editor?.destroy()
      host.remove()
    },
  }
}
