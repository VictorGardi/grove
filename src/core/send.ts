import type { Result } from '@shared/ipc'
import type { Session } from '@shared/types'
import type { SessionBackend } from './backend/types'

export interface SendDeps {
  find(id: string): Session | undefined
  backend: SessionBackend
}

// Text into a session's tmux pane as one bracketed paste (ADR 0023). Live sessions only for now.
export async function sendToSession(deps: SendDeps, a: { id: string; text: string; submit?: boolean }): Promise<Result<{ id: string }>> {
  const session = deps.find(a.id)
  if (!session) return { ok: false, error: 'not-found' }
  if (session.lastStatus === 'gone') return { ok: false, error: 'gone' }
  try {
    await deps.backend.paste(session.tmuxName, a.text, a.submit ?? true)
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) }
  }
  return { ok: true, data: { id: a.id } }
}
