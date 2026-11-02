import type { Result } from '@shared/ipc'
import type { Session } from '@shared/types'
import type { SessionBackend } from './backend/types'

export interface DictateDeps {
  find(id: string): Session | undefined
  backend: SessionBackend
}

const MAX_TEXT = 4000

// The renderer is untrusted: one line of printable text, so the paste can never submit or carry an escape sequence.
export function sanitizeDictation(text: unknown): string {
  if (typeof text !== 'string') return ''
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()
  // Cut by code points so the cap never leaves half of a surrogate pair.
  return Array.from(flat).slice(0, MAX_TEXT).join('').trim()
}

// The paste ends in one space so consecutive dictations or half-typed text never glue words together.
// Dictated text into a session's pane as one bracketed paste, never submitted. Unlike sendToSession it
// neither resumes a gone session nor waits for the pane: the human is looking at a live terminal.
export async function dictate(deps: DictateDeps, a: { id: string; text: string }): Promise<Result<{ id: string }>> {
  const text = sanitizeDictation(a.text)
  if (!text) return { ok: false, error: 'empty' }
  const session = deps.find(a.id)
  if (!session) return { ok: false, error: 'not-found' }
  if (session.lastStatus === 'gone') return { ok: false, error: 'gone' }
  try {
    await deps.backend.paste(session.tmuxName, text + ' ', false)
  } catch (e) {
    const now = deps.find(a.id)
    if (!now) return { ok: false, error: 'not-found' }
    if (now.lastStatus === 'gone') return { ok: false, error: 'gone' }
    return { ok: false, error: String((e as Error)?.message ?? e) }
  }
  return { ok: true, data: { id: a.id } }
}
