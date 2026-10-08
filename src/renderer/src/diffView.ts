import type { CommentAnchor, DiffFile, DiffLine, SessionDiff } from '@shared/types'

export function visibleFiles(d: SessionDiff, showUntracked: boolean): DiffFile[] {
  return showUntracked ? d.files : d.files.filter((f) => f.status !== 'untracked')
}

// A line's identity (design): add → new side, del → old side, context → new side.
export function lineKey(path: string, l: DiffLine): string {
  return l.kind === 'del' ? `${path}:old:${l.old}` : `${path}:new:${l.new}`
}

export const sideOf = (l: DiffLine): 'old' | 'new' => (l.kind === 'del' ? 'old' : 'new')

// The comment anchor for the lines of one hunk on one side, between two clicked line indices (either order).
export function rangeAnchor(root: string, file: DiffFile, hunk: number, side: 'old' | 'new', a: number, b: number): Extract<CommentAnchor, { kind: 'diff' }> | null {
  const lines = file.hunks[hunk]?.lines.slice(Math.min(a, b), Math.max(a, b) + 1).filter((l) => sideOf(l) === side) ?? []
  if (lines.length === 0) return null
  const num = (l: DiffLine) => (side === 'old' ? l.old : l.new)!
  return { kind: 'diff', root, path: file.path, side, start: num(lines[0]), end: num(lines[lines.length - 1]), lines: lines.map((l) => l.text) }
}

// The comment being written: lines of one hunk on one side, from `origin` to `end` (hunk line indices).
export interface DraftRange { path: string; hunk: number; side: 'old' | 'new'; origin: number; end: number }
export interface LineRef { path: string; hunk: number; li: number }

// The range a text selection from one line to another stands for: the side of its first line, and only
// that side's lines. null when it spans files or hunks, or has no line of that side.
export function selectionRange(file: DiffFile, a: LineRef, b: LineRef): DraftRange | null {
  if (a.path !== b.path || a.hunk !== b.hunk || a.path !== file.path) return null
  const lines = file.hunks[a.hunk]?.lines
  if (!lines) return null
  const lo = Math.min(a.li, b.li)
  const hi = Math.max(a.li, b.li)
  if (!lines[lo] || !lines[hi]) return null
  const side = sideOf(lines[lo])
  const idx: number[] = []
  for (let i = lo; i <= hi; i++) if (sideOf(lines[i]) === side) idx.push(i)
  return { path: file.path, hunk: a.hunk, side, origin: idx[0], end: idx[idx.length - 1] }
}

// --- Word-level marks: inside a removed line and the added line that replaces it ---

export interface Seg { text: string; changed: boolean }

const MAX_TOKENS = 300 // longer lines are shown without word marks
const tokens = (t: string) => t.match(/\w+|\s+|[^\w\s]/g) ?? []

const merge = (segs: Seg[]): Seg[] => segs.reduce<Seg[]>((out, s) => {
  const last = out[out.length - 1]
  if (last && last.changed === s.changed) last.text += s.text
  else out.push({ ...s })
  return out
}, [])

// The words that differ between two lines, by longest common subsequence of tokens. null: too long,
// or nothing in common (every word changed, so the whole line colour says it already).
export function wordSegs(a: string, b: string): [Seg[], Seg[]] | null {
  const x = tokens(a)
  const y = tokens(b)
  if (x.length > MAX_TOKENS || y.length > MAX_TOKENS) return null
  const lcs: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0))
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  }
  const left: Seg[] = []
  const right: Seg[] = []
  let i = 0
  let j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      left.push({ text: x[i], changed: false })
      right.push({ text: y[j], changed: false })
      i++
      j++
    } else if (j >= y.length || (i < x.length && lcs[i + 1][j] >= lcs[i][j + 1])) left.push({ text: x[i++], changed: true })
    else right.push({ text: y[j++], changed: true })
  }
  if (!left.some((t) => !t.changed && t.text.trim())) return null
  return [merge(left), merge(right)]
}

// Segments by line index for the lines of a hunk that sit in a changed block: the i-th removed line of a
// block pairs with its i-th added line.
export function wordMarks(lines: DiffLine[]): Map<number, Seg[]> {
  const out = new Map<number, Seg[]>()
  for (let i = 0; i < lines.length;) {
    if (lines[i].kind === 'context') { i++; continue }
    const dels: number[] = []
    const adds: number[] = []
    while (i < lines.length && lines[i].kind === 'del') dels.push(i++)
    while (i < lines.length && lines[i].kind === 'add') adds.push(i++)
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const pair = wordSegs(lines[dels[k]].text, lines[adds[k]].text)
      if (!pair) continue
      out.set(dels[k], pair[0])
      out.set(adds[k], pair[1])
    }
  }
  return out
}

// --- Side by side ---

export interface Cell { li: number; line: DiffLine }
export interface SplitRow { left: Cell | null; right: Cell | null } // a context line is in both

// A hunk's lines as rows: context on both sides; a block of removed then added lines side by side.
export function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  for (let i = 0; i < lines.length;) {
    if (lines[i].kind === 'context') {
      rows.push({ left: { li: i, line: lines[i] }, right: { li: i, line: lines[i] } })
      i++
      continue
    }
    const dels: Cell[] = []
    const adds: Cell[] = []
    while (i < lines.length && lines[i].kind === 'del') { dels.push({ li: i, line: lines[i] }); i++ }
    while (i < lines.length && lines[i].kind === 'add') { adds.push({ li: i, line: lines[i] }); i++ }
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null })
  }
  return rows
}

// --- Unmodified lines between hunks ---

// Lines the diff leaves out before hunk `index` (new-file numbers, inclusive); old = new + delta.
export interface Gap { index: number; from: number; to: number; delta: number }

export function gaps(file: DiffFile): Gap[] {
  if (file.status === 'deleted' || file.binary || file.truncated) return []
  const out: Gap[] = []
  let prevEnd = 0
  let delta = 0
  file.hunks.forEach((h, index) => {
    const news = h.lines.filter((l) => l.new !== null).map((l) => l.new!)
    // a hunk with no new lines only removes: git numbers it by the line before
    const first = news.length ? news[0] : h.newStart + 1
    const last = news.length ? news[news.length - 1] : h.newStart
    if (first - 1 >= prevEnd + 1) out.push({ index, from: prevEnd + 1, to: first - 1, delta })
    prevEnd = last
    delta += h.lines.filter((l) => l.kind === 'del').length - h.lines.filter((l) => l.kind === 'add').length
  })
  return out
}

// --- The file list ---

export const STATUS_LETTER: Record<DiffFile['status'], string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: '?' }

export function filterFiles(files: DiffFile[], query: string): DiffFile[] {
  const q = query.trim().toLowerCase()
  return q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files
}

export function fileFocusTarget(index: number, direction: 'up' | 'down', count: number): number | 'filter' | null {
  if (count === 0) return null
  if (index < 0) return direction === 'down' ? 0 : 'filter'
  const next = index + (direction === 'down' ? 1 : -1)
  return next < 0 ? 'filter' : next < count ? next : null
}

// The file to show: the chosen one if still listed, else the first.
export const pickFile = (files: DiffFile[], path: string | null): DiffFile | null => files.find((f) => f.path === path) ?? files[0] ?? null

// --- The file tree (GitHub-style: directories before files, both alphabetical; a run of
// directories that each hold only one subdirectory collapses into a single "a/b/c" row) ---

export interface DirRow { kind: 'dir'; path: string; name: string; depth: number; collapsed: boolean }
export interface FileRow { kind: 'file'; path: string; name: string; depth: number; file: DiffFile }
export type TreeRow = DirRow | FileRow

interface Branch { name: string; path: string; dirs: Map<string, Branch>; files: DiffFile[] }

function branchOf(root: Branch, parts: string[]): Branch {
  let node = root
  for (const name of parts) {
    const path = node.path ? `${node.path}/${name}` : name
    let next = node.dirs.get(name)
    if (!next) {
      next = { name, path, dirs: new Map(), files: [] }
      node.dirs.set(name, next)
    }
    node = next
  }
  return node
}

// A directory with no files of its own and exactly one subdirectory folds into it, repeatedly.
function collapseChain(node: Branch): Branch {
  while (node.files.length === 0 && node.dirs.size === 1) {
    const [only] = node.dirs.values()
    node = { name: node.name ? `${node.name}/${only.name}` : only.name, path: only.path, dirs: only.dirs, files: only.files }
  }
  return node
}

// `collapsedDirs` holds directory paths the caller has toggled shut; `forceExpand` (e.g. while
// filtering) ignores that and walks every directory open.
export function fileTreeRows(files: DiffFile[], collapsedDirs: ReadonlySet<string>, forceExpand: boolean): TreeRow[] {
  const root: Branch = { name: '', path: '', dirs: new Map(), files: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    branchOf(root, parts.slice(0, -1)).files.push(f)
  }

  const out: TreeRow[] = []
  const walk = (node: Branch, depth: number) => {
    const dirs = [...node.dirs.values()].map(collapseChain).sort((a, b) => a.name.localeCompare(b.name))
    for (const d of dirs) {
      const collapsed = !forceExpand && collapsedDirs.has(d.path)
      out.push({ kind: 'dir', path: d.path, name: d.name, depth, collapsed })
      if (!collapsed) walk(d, depth + 1)
    }
    for (const f of [...node.files].sort((a, b) => a.path.localeCompare(b.path))) {
      out.push({ kind: 'file', path: f.path, name: f.path.slice(f.path.lastIndexOf('/') + 1), depth, file: f })
    }
  }
  walk(root, 0)
  return out
}
