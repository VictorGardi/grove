import type { Result } from '@shared/ipc'
import type { Session } from '@shared/types'
import type { SessionBackend } from './backend/types'

export interface DictateDeps {
  find(id: string): Session | undefined
  backend: SessionBackend
}

// Dictated text into a session's pane as one bracketed paste, never submitted. Unlike sendToSession it
// neither resumes a gone session nor waits for the pane: the human is looking at a live terminal.
export async function dictate(deps: DictateDeps, a: { id: string; text: string }): Promise<Result<{ id: string }>> {
  const session = deps.find(a.id)
  if (!session) return { ok: false, error: 'not-found' }
  if (session.lastStatus === 'gone') return { ok: false, error: 'gone' }
  try {
    await deps.backend.paste(session.tmuxName, a.text, false)
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) }
  }
  return { ok: true, data: { id: a.id } }
}
