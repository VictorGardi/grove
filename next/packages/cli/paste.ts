const SETTLE_MS = 1000 // after a resume, before looking at the screen
const STABLE_MS = 1000 // the screen text must hold this long
const READY_TIMEOUT_MS = 20_000
const POLL_MS = 250
const SUBMIT_DELAY_MS = 150 // a TUI takes Enter inside the paste otherwise

// C0 and C1 controls except newline and tab. A pasted ESC[201~ would end the bracketed paste early
// and run the rest as typed input (ADR 0023), so nothing sent to a tab may carry one.
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

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
  await write(`\x1b[200~${text.replace(CONTROLS, '')}\x1b[201~`)
  if (!submit) return
  await sleep(SUBMIT_DELAY_MS)
  await write('\r')
}
