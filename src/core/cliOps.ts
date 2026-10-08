import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { TurnResult } from '@shared/cli'
import type { Result } from '@shared/ipc'
import type { Project, Session } from '@shared/types'
import { newProject } from './projects'

const MIN_PREFIX = 4

// A session by full id, a unique id prefix (≥ 4 chars), or an exact label (ADR 0027).
export function resolveSessionRef(sessions: Session[], ref: string): Result<Session> {
  const exact = sessions.find((s) => s.id === ref)
  if (exact) return { ok: true, data: exact }
  const pick = (found: Session[]): Result<Session> | null =>
    found.length === 1 ? { ok: true, data: found[0] } : found.length > 1 ? { ok: false, error: 'ambiguous' } : null
  const byPrefix = ref.length >= MIN_PREFIX ? pick(sessions.filter((s) => s.id.startsWith(ref))) : null
  return byPrefix ?? pick(sessions.filter((s) => s.label === ref)) ?? { ok: false, error: 'not-found' }
}

export function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

export function realOrSelf(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

const contains = (dir: string, p: string) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep)

// The registered project with the longest path containing `cwd`; none: the folder's git top level, or the folder.
// The caller registers the project when `added` (C4).
export async function resolveProject(
  projects: Project[],
  cwd: string,
  gitTop: (dir: string) => Promise<string | null>
): Promise<{ project: Project; added: boolean }> {
  const dir = realOrSelf(cwd)
  let best: Project | null = null
  for (const p of projects) {
    const root = realOrSelf(p.path)
    if (contains(root, dir) && (!best || root.length > realOrSelf(best.path).length)) best = p
  }
  if (best) return { project: best, added: false }
  const top = (await gitTop(dir)) ?? dir
  return { project: newProject(top, randomUUID()), added: true }
}

// True once two captures `intervalMs` apart match (a TUI has finished drawing); false after `timeoutMs`.
export async function paneStable(
  capture: () => Promise<string>,
  o: { intervalMs: number; timeoutMs: number; sleep?: (ms: number) => Promise<void> }
): Promise<boolean> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let prev = await capture()
  for (let waited = 0; waited < o.timeoutMs; waited += o.intervalMs) {
    await sleep(o.intervalMs)
    const next = await capture()
    if (next === prev) return true
    prev = next
  }
  return false
}

export interface WaitDeps {
  find(id: string): Session | undefined
  onSessions(cb: () => void): () => void // calls back whenever the sessions slice changes
}

const START_WAIT_MS = 30_000

// Blocks until the session stops working (ADR 0027). `expectStart`: first give the turn up to `startWaitMs` to begin.
// An agent session with no status (its source is disconnected) keeps waiting; a terminal has none to wait on.
export function waitTurn(
  deps: WaitDeps,
  id: string,
  o: { expectStart: boolean; timeoutMs: number; startWaitMs?: number }
): Promise<Result<TurnResult>> {
  const first = deps.find(id)
  if (!first) return Promise.resolve({ ok: false, error: 'not-found' })
  if (first.kind === 'terminal') return Promise.resolve({ ok: false, error: 'no-status' })
  return new Promise((resolve) => {
    let started = !o.expectStart
    const timers: ReturnType<typeof setTimeout>[] = []
    let off = () => {}
    const finish = (r: Result<TurnResult>) => {
      off()
      for (const t of timers) clearTimeout(t)
      resolve(r)
    }
    const check = () => {
      const s = deps.find(id)
      if (!s || s.lastStatus === 'gone') return finish({ ok: true, data: { status: 'gone', waitingFor: null } })
      if (s.status === 'working') started = true
      if (!started || !s.status || s.status === 'working') return
      const blocked = s.status === 'waiting' && (s.waitingFor === 'permission' || s.waitingFor === 'question')
      finish({ ok: true, data: blocked ? { status: 'waiting', waitingFor: s.waitingFor ?? null } : { status: 'idle', waitingFor: null } })
    }
    off = deps.onSessions(check)
    timers.push(setTimeout(() => finish({ ok: false, error: 'timeout' }), o.timeoutMs))
    if (!started) {
      timers.push(setTimeout(() => { started = true; check() }, o.startWaitMs ?? START_WAIT_MS))
    }
    check()
  })
}
