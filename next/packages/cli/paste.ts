import { bracketedPaste } from '../protocol/paste.ts'

const SETTLE_MS = 1000 // after a resume, before looking at the screen
const STABLE_MS = 1000 // the screen text must hold this long
const READY_TIMEOUT_MS = 20_000
const POLL_MS = 250
const SUBMIT_DELAY_MS = 150 // a TUI takes Enter inside the paste otherwise

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// The screen has text and it has stopped changing: the agent drew its prompt.
export async function waitStable(read: () => Promise<string>): Promise<boolean> {
  const t0 = Date.now()
  await sleep(SETTLE_MS)
  let last = await read()
  let since = Date.now()
  while (Date.now() - t0 < READY_TIMEOUT_MS) {
    if (last.trim() !== '' && Date.now() - since >= STABLE_MS) return true
    await sleep(POLL_MS)
    const cur = await read()
    if (cur !== last) {
      last = cur
      since = Date.now()
    }
  }
  return false
}

// The text as one bracketed paste, then Enter when `submit`.
export async function pasteText(write: (data: string) => Promise<void>, text: string, submit: boolean): Promise<void> {
  await write(bracketedPaste(text))
  if (!submit) return
  await sleep(SUBMIT_DELAY_MS)
  await write('\r')
}
