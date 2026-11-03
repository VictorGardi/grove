import type { Session } from '@shared/types'
import { asksHuman } from '@shared/attention'
import { queueStatus, shownStatus, type ShownStatus } from './sessionStatus'

export interface Family {
  parent: Session | null
  children: Session[]
  active: Session | null
}

// A child is ended once its pane is gone or its start failed: it can't be the one to jump to.
export const isEnded = (s: Session) => {
  const shown = shownStatus(s)
  return shown === 'gone' || shown === 'failed'
}

// "1 child", "3 children": the parent's count chip.
export const childrenCount = (n: number) => (n === 1 ? '1 child' : `${n} children`)

// Running children, most worth a look first. waiting is a wait that asks the human (a finished child ranks as idle);
// running is a live pane with no agent status (a terminal); starting has nothing to show yet.
const RANK: ShownStatus[] = ['waiting', 'working', 'idle', 'running', 'starting']

// A missing or malformed time is -Infinity, never NaN, so it sorts last.
const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? -Infinity : t
}

// Later first; a missing time sorts last.
const later = (a: string | null | undefined, b: string | null | undefined) => {
  const ta = time(a), tb = time(b)
  return ta === tb ? 0 : tb > ta ? 1 : -1
}

function byRunning(a: Session, b: Session): number {
  const ra = RANK.indexOf(queueStatus(a)), rb = RANK.indexOf(queueStatus(b))
  if (ra !== rb) return ra - rb
  return later(a.lastFocusedAt, b.lastFocusedAt) || later(a.startedAt, b.startedAt)
}

// A session's group as seen from it: its parent (if still there), its children (running first,
// by rank; then ended ones, newest first; never store order), and the child a jump goes to.
export function familyOf(sessions: Session[], id: string): Family {
  const self = sessions.find((s) => s.id === id)
  const parent = self?.link ? sessions.find((s) => s.id === self.link!.id) ?? null : null
  const mine = sessions.filter((s) => s.link?.id === id)
  const running = mine.filter((s) => !isEnded(s)).sort(byRunning)
  const done = mine.filter(isEnded).sort((a, b) => later(a.startedAt, b.startedAt))
  return { parent, children: [...running, ...done], active: running[0] ?? null }
}

// ⌘⇧J: a child goes to its parent, a parent to its active child, anything else nowhere.
export function familyJumpTarget(sessions: Session[], focusedId: string | null | undefined): Session | null {
  if (!focusedId) return null
  const f = familyOf(sessions, focusedId)
  return f.parent ?? f.active
}

export interface RunProgress { done: number; total: number; kidsDone: number; label: string; pct: number }

// A run's progress bar: `grove progress` slices done of total, and how many children are marked done.
export function runProgress(parent: Session, kids: Session[]): RunProgress | null {
  const p = parent.progress
  if (!p) return null
  const kidsDone = kids.filter((k) => k.workflowStatus === 'done').length
  const base = `${p.done} of ${p.total} slices done`
  const label = kidsDone > 0 ? `${base}, ${kidsDone} ${kidsDone === 1 ? 'child' : 'children'} done` : base
  const pct = p.total > 0 ? Math.min(100, Math.max(0, Math.round((100 * p.done) / p.total))) : 0
  return { done: p.done, total: p.total, kidsDone, label, pct }
}

export interface BarCounts { done: number; failed: number; run: number; wait: number; queued: number; needsYou: number; text: string; label: string }

// A parent's proportional bar: every child counted once (done, then waiting on the human, then failed, else running),
// plus the slices of the plan not started yet. Never one mark per child.
export function barCounts(parent: Session, kids: Session[]): BarCounts {
  let done = 0, failed = 0, run = 0, wait = 0
  for (const k of kids) {
    if (k.workflowStatus === 'done') done++
    else if (asksHuman(k)) wait++
    else if (shownStatus(k) === 'failed') failed++
    else run++
  }
  const p = parent.progress
  const queued = p ? Math.max(0, p.total - kids.length) : 0
  const text = p ? `${p.done}/${p.total}` : `${done} of ${kids.length}`
  const head = p ? `${p.done} of ${p.total} slices done` : `${done} of ${kids.length} children done`
  const parts = [
    run && `${run} running`,
    failed && `${failed} failed`,
    wait && `${wait} needs you`,
    queued && `${queued} not started`,
  ].filter(Boolean)
  return { done, failed, run, wait, queued, needsYou: wait, text, label: [head, ...parts].join(', ') }
}
