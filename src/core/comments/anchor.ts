import type { Comment, CommentAnchor, DiffFile, SessionDiff } from '@shared/types'
import { parseMarkdown } from '../artifacts/markdown'

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

const collapse = (t: string) => t.replace(/\s+/g, ' ').trim()

function inlineText(children: { type: string; content: string }[] | null): string {
  return (children ?? []).map((c) => (c.type === 'text' || c.type === 'code_inline' || c.type === 'image' ? c.content
    : c.type === 'softbreak' || c.type === 'hardbreak' ? ' ' : '')).join('')
}

// The rendered text of each leaf block of a markdown file with its 1-based whole-file lines (the
// same lines as the viewer's data-line). Table cells take their row's lines.
export function blockText(source: string): { start: number; end: number; text: string }[] {
  const { tokens, env } = parseMarkdown(source)
  const out: { start: number; end: number; text: string }[] = []
  let lines: [number, number] = [1, 1]
  for (const t of tokens) {
    if (t.map && t.type !== 'inline') lines = [t.map[0] + 1 + env.lineOffset, t.map[1] + env.lineOffset]
    if (t.type === 'inline' && t.map) lines = [t.map[0] + 1 + env.lineOffset, t.map[1] + env.lineOffset]
    const text = t.type === 'inline' ? inlineText(t.children) : t.type === 'fence' || t.type === 'code_block' ? t.content : null
    if (text === null) continue
    const c = collapse(text)
    if (c) out.push({ start: lines[0], end: lines[1], text: c })
  }
  return out
}

type ArtifactAnchor = Extract<CommentAnchor, { kind: 'artifact' }>

// Drafts on this file follow their quote through the file's blocks; none or several matches → orphaned (D3).
// The same array when nothing changed.
export function reanchorArtifact(cs: Comment[], file: { projectId: string; slug: string; path: string }, source: string): Comment[] {
  const mine = (c: Comment): c is Comment & { anchor: ArtifactAnchor } => c.state === 'draft' && c.anchor.kind === 'artifact'
    && c.anchor.projectId === file.projectId && c.anchor.slug === file.slug && c.anchor.path === file.path
  if (!cs.some(mine)) return cs
  const blocks = blockText(source)
  const spans: { from: number; to: number; start: number; end: number }[] = []
  let text = ''
  for (const b of blocks) {
    if (text) text += ' '
    spans.push({ from: text.length, to: text.length + b.text.length, start: b.start, end: b.end })
    text += b.text
  }
  const all = (needle: string): number[] => {
    const hits: number[] = []
    for (let i = text.indexOf(needle); needle && i >= 0; i = text.indexOf(needle, i + 1)) hits.push(i)
    return hits
  }
  const blockAt = (pos: number) => spans.find((s) => pos >= s.from && pos < s.to) ?? spans.find((s) => pos < s.from) ?? spans[spans.length - 1]

  let changed = false
  const out = cs.map((c) => {
    if (!mine(c)) return c
    const a = c.anchor
    const exact = collapse(a.exact)
    const tiers: [string, number][] = [[a.prefix + exact + a.suffix, a.prefix.length], [a.prefix + exact, a.prefix.length], [exact + a.suffix, 0], [exact, 0]]
    let at: number | null = null
    for (const [needle, lead] of tiers) {
      const hits = all(needle)
      if (hits.length === 0) continue
      at = hits.length === 1 ? hits[0] + lead : null
      break
    }
    if (at === null || !spans.length) {
      if (c.orphaned) return c
      changed = true
      return { ...c, orphaned: true }
    }
    const start = blockAt(at).start
    const end = blockAt(at + Math.max(exact.length - 1, 0)).end
    if (start === a.start && end === a.end && !c.orphaned) return c
    changed = true
    return { ...c, orphaned: false, anchor: { ...a, start, end } }
  })
  return changed ? out : cs
}
