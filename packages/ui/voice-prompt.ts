// The one-time question Voice input asks before it downloads its speech model (ADR 0006): what it is, how big, that it is the one
// time Grove uses the network. A yes starts the download and shows its progress; the dialog closes when it is done.

export interface VoicePromptElements {
  backdrop: HTMLElement
  text: HTMLElement
  progress: HTMLProgressElement
  error: HTMLElement
  cancel: HTMLButtonElement
  accept: HTMLButtonElement
}

export interface VoicePromptDeps {
  // Downloads the model, telling how far it is; rejects with why it failed.
  download(progress: (done: number, total: number) => void): Promise<void>
  // Said when the download is done and the dialog is gone.
  ready(): void
  bytes(): number
}

export const megabytes = (bytes: number): string => `${Math.round(bytes / 1_000_000)} MB`

export interface VoicePrompt {
  // Asks; true when the human said yes (the download then runs inside the dialog), false for not now.
  offer(): Promise<boolean>
  isOpen(): boolean
}

export function createVoicePrompt(els: VoicePromptElements, deps: VoicePromptDeps): VoicePrompt {
  let open = false
  let downloading = false
  let answer: ((accepted: boolean) => void) | null = null

  function close(accepted: boolean): void {
    els.backdrop.hidden = true
    open = false
    answer?.(accepted)
    answer = null
  }

  els.cancel.addEventListener('click', () => {
    if (!downloading) close(false)
  })
  els.accept.addEventListener('click', () => {
    if (downloading) return
    downloading = true
    els.error.hidden = true
    els.accept.disabled = true
    els.cancel.disabled = true
    els.progress.hidden = false
    els.progress.value = 0
    els.text.textContent = 'Downloading the speech model…'
    deps
      .download((done, total) => {
        els.progress.max = total
        els.progress.value = done
        els.text.textContent = `Downloading the speech model… ${megabytes(done)} of ${megabytes(total)}`
      })
      .then(() => {
        downloading = false
        close(true)
        deps.ready()
      })
      .catch((error: unknown) => {
        downloading = false
        els.progress.hidden = true
        els.error.textContent = error instanceof Error ? error.message : String(error)
        els.error.hidden = false
        els.accept.disabled = false
        els.accept.textContent = 'Try again'
        els.cancel.disabled = false
        els.text.textContent = describe(deps.bytes())
      })
  })

  const describe = (bytes: number): string =>
    `Voice input turns your speech into text on this Mac, so it needs a speech model of about ${megabytes(bytes)}. Grove downloads it once, now, and after that works offline. This is the one time Grove uses the network. Your audio is never saved or sent anywhere.`

  return {
    offer() {
      if (open) return Promise.resolve(false)
      open = true
      els.text.textContent = describe(deps.bytes())
      els.progress.hidden = true
      els.error.hidden = true
      els.accept.disabled = false
      els.accept.textContent = 'Download'
      els.cancel.disabled = false
      els.backdrop.hidden = false
      return new Promise((resolve) => {
        answer = resolve
      })
    },
    isOpen: () => open,
  }
}
