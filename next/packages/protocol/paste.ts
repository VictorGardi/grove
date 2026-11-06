// The text of a tab write as one bracketed paste. The CLI and the window both paste through it, so they send the same bytes.

// C0 and C1 controls except newline and tab. A pasted ESC[201~ would end the bracketed paste early
// and run the rest as typed input (ADR 0023), so nothing sent to a tab may carry one.
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

export function bracketedPaste(text: string): string {
  return `\x1b[200~${text.replace(CONTROLS, '')}\x1b[201~`
}
