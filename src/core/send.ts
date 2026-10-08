import type { Result } from '@shared/ipc'
import type { Session } from '@shared/types'
import type { SessionBackend } from './backend/types'

export interface SendDeps {
  find(id: string): Session | undefined
  backend: SessionBackend
  resume?(id: string): Promise<Result<unknown>> // gone agent sessions
  sleep?(ms: number): Promise<void> // tests inject a fake clock
  now?(): number
}

const SETTLE_MS = 1000 // after a resume, before looking at the pane
const STABLE_MS = 1000 // the pane text must hold this long
const READY_TIMEOUT_MS = 20_000
const POLL_MS = 250

// The pane has text and it has stopped changing: the agent drew its prompt.
async function waitStable(deps: SendDeps, name: string): Promise<boolean> {
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  const t0 = now()
  await sleep(SETTLE_MS)
  let last = await deps.backend.capture(name, 50)
  let since = now()
  while (now() - t0 < READY_TIMEOUT_MS) {
    if (last !== '' && now() - since >= STABLE_MS) return true
    await sleep(POLL_MS)
    const cur = await deps.backend.capture(name, 50)
    if (cur !== last) {
      last = cur
      since = now()
    }
  }
  return false
}

// Text into a session's tmux pane as one bracketed paste (ADR 0023). A gone agent session is resumed
// and given time to draw its prompt first; a working one takes the paste at once.
export async function sendToSession(deps: SendDeps, a: { id: string; text: string; submit?: boolean }): Promise<Result<{ id: string }>> {
  const session = deps.find(a.id)
  if (!session) return { ok: false, error: 'not-found' }
  try {
    if (session.lastStatus === 'gone') {
      if (session.kind === 'terminal' || !session.agentSessionId || !deps.resume) return { ok: false, error: 'gone' }
      const resumed = await deps.resume(a.id)
      if (!resumed.ok) return { ok: false, error: resumed.error }
      const name = deps.find(a.id)?.tmuxName ?? session.tmuxName
      if (!(await waitStable(deps, name))) return { ok: false, error: 'not-ready' }
    }
    await deps.backend.paste(session.tmuxName, a.text, a.submit ?? true)
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) }
  }
  return { ok: true, data: { id: a.id } }
}
