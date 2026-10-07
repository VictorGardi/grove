import type { Comment, CommentAnchor, DiffFile, SessionDiff } from '@shared/types'

type DiffAnchor = Extract<CommentAnchor, { kind: 'diff' }>

// A file's lines on one side, as (number, text), in order; hunks are separate runs.
function sideRuns(file: DiffFile, side: 'old' | 'new'): { n: number; text: string }[][] {
  return file.hunks.map((h) => h.lines.flatMap((l) => {
    const n = side === 'old' ? l.old : l.new
    return n === null ? [] : [{ n, text: l.text }]
  }))
}

// Start of the run of consecutive numbers whose texts equal `lines`, nearest `near`; null: none.
function findRun(runs: { n: number; text: string }[][], lines: string[], near: number): number | null {
  let best: number | null = null
  for (const run of runs) {
    for (let i = 0; i + lines.length <= run.length; i++) {
      let ok = true
      for (let j = 0; j < lines.length && ok; j++) ok = run[i + j].text === lines[j] && run[i + j].n === run[i].n + j
      if (!ok) continue
      const start = run[i].n
      if (best === null || Math.abs(start - near) < Math.abs(best - near) || (Math.abs(start - near) === Math.abs(best - near) && start < best)) best = start
    }
  }
  return best
}

function place(c: Comment & { anchor: DiffAnchor }, diff: SessionDiff): Comment {
  const a = c.anchor
  const file = diff.files.find((f) => f.path === a.path)
  if (file && (file.binary || file.truncated)) return c // hunks cut: can't judge
  const start = file ? findRun(sideRuns(file, a.side), a.lines, a.start) : null
  if (start === null) return c.orphaned ? c : { ...c, orphaned: true }
  const end = start + a.lines.length - 1
  if (start === a.start && end === a.end && !c.orphaned) return c
  return { ...c, orphaned: false, anchor: { ...a, start, end } }
}

// Drafts of the diff's session follow their lines; lost ones are marked orphaned (design D3).
// The same array when nothing changed.
export function reanchorDiff(cs: Comment[], diff: SessionDiff): Comment[] {
  if (diff.state !== 'ok' || diff.truncated) return cs
  let changed = false
  const out = cs.map((c) => {
    if (c.state !== 'draft' || c.sessionId !== diff.sessionId || c.anchor.kind !== 'diff' || c.anchor.root !== diff.root) return c
    const next = place(c as Comment & { anchor: DiffAnchor }, diff)
    if (next !== c) changed = true
    return next
  })
  return changed ? out : cs
}
