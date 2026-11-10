import type { AgentStateName, NeedsYouReason } from '../protocol/messages.ts'
import type { TurnOutcome } from './output.ts'

// A tab as the wait sees it: its saved kind and holder liveness (spaces.list) and its agent state (agents.list).
export interface WaitTab {
  kind: string
  alive: boolean
  state: AgentStateName | null
  reason?: NeedsYouReason
}

export interface WaitDeps {
  find(id: string): Promise<WaitTab | undefined>
  onChange(cb: () => void): void // status.changed; the poll covers a notification that lands while a check runs
}

const POLL_MS = 500
export const START_WAIT_MS = 30_000

// Blocks until the tab stops working. `expectStart`: first give the turn up to `startWaitMs` to begin.
// A permission or question keeps waiting: it is for the human, never the caller.
// An agent with no state (its source is disconnected) keeps waiting; a shell tab has none to wait on.
export async function waitTurn(
  deps: WaitDeps,
  id: string,
  o: { expectStart: boolean; timeoutMs: number; startWaitMs?: number },
): Promise<TurnOutcome> {
  const first = await deps.find(id)
  if (!first) return { ok: false, error: 'not-found' }
  // A shell tab that exited is gone, like any other; only a live one has no state to wait on.
  if (first.kind === 'terminal' && first.alive) return { ok: false, error: 'no-status' }
  return new Promise((resolve, reject) => {
    let started = !o.expectStart
    let busy = false
    let again = false // a change arrived while a check ran: check once more after it
    let done = false
    const timers: ReturnType<typeof setTimeout>[] = []
    const settle = (r: TurnOutcome | Error) => {
      if (done) return
      done = true
      for (const t of timers) clearTimeout(t)
      if (r instanceof Error) reject(r)
      else resolve(r)
    }
    const judge = (s: WaitTab | undefined) => {
      if (!s || !s.alive) return settle({ ok: true, data: { status: 'gone' } })
      if (s.state === 'working') started = true
      if (!started || s.state === null || s.state === 'working' || s.state === 'unknown') return
      if (s.state === 'needs-you' && (s.reason === 'permission' || s.reason === 'question')) return
      settle({ ok: true, data: { status: 'idle' } })
    }
    const check = async () => {
      if (busy) {
        again = true
        return
      }
      busy = true
      try {
        do {
          again = false
          const s = await deps.find(id)
          if (done) return
          judge(s)
        } while (again && !done)
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)))
      } finally {
        busy = false
      }
    }
    timers.push(setTimeout(() => settle({ ok: false, error: 'timeout' }), o.timeoutMs))
    if (!started) timers.push(setTimeout(() => { started = true; void check() }, o.startWaitMs ?? START_WAIT_MS))
    timers.push(setInterval(() => void check(), POLL_MS))
    deps.onChange(() => void check())
    void check()
  })
}

// True once the tab reports working; false when it is gone or `timeoutMs` passes first. Not an error either way.
export async function waitForWorking(find: WaitDeps['find'], id: string, timeoutMs = START_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const s = await find(id)
    if (!s || !s.alive) return false
    if (s.state === 'working') return true
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}
