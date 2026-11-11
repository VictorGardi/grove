// What the diff panel decides before it draws: the files that match the filter, the change bar and the word marks inside changed lines, the
// base picker's choices, what to say when there is nothing to show, and when an agent's change of state is a reason to look again.
// Ported from old Grove's diffView.ts and diffBases.ts.
import type { AgentKind } from '../core/status/adapter.ts'
import { DIFF_COMMENT_LIMITS, type AgentStateName, type DiffComment, type NeedsYouReason, type DiffCompared, type DiffFile, type DiffLine, type DiffMode } from '../protocol/messages.ts'

export const MODE_LABEL: Record<DiffMode, string> = { branch: 'Branch', uncommitted: 'Uncommitted', 'last-commit': 'Last commit' }
export const MODES: readonly DiffMode[] = ['branch', 'uncommitted', 'last-commit']
export const MAX_RECENT_BASES = 5

// Whether a card can flip to a rendered preview: a markdown file that is there, readable and within the size the diff shows.
export function canPreview(file: DiffFile): boolean {
  return /\.(md|markdown)$/i.test(file.path) && file.status !== 'deleted' && !file.binary && !file.truncated
}

// The files whose path contains `filter`, case-insensitively, in the order the core sent them.
export function matchFiles(files: readonly DiffFile[], filter: string): DiffFile[] {
  const query = filter.trim().toLowerCase()
  return query === '' ? [...files] : files.filter((file) => file.path.toLowerCase().includes(query))
}

// A path as the directory (with its trailing slash) and the file name.
export function splitPath(path: string): { dir: string; name: string } {
  const cut = path.lastIndexOf('/') + 1
  return { dir: path.slice(0, cut), name: path.slice(cut) }
}

// The chip a card shows for a file that is new, gone or moved; modified files have none.
export const STATUS_CHIP: Partial<Record<DiffFile['status'], string>> = { added: 'New', untracked: 'New', deleted: 'Deleted', renamed: 'Renamed' }

export const BAR_SQUARES = 5

// The five squares beside a file's counts: green for the share of additions, red for the rest, grey with nothing counted.
export function changeBar(additions: number, deletions: number): Array<'add' | 'del' | 'none'> {
  const total = additions + deletions
  if (total === 0) return Array.from({ length: BAR_SQUARES }, () => 'none')
  let green = Math.round((additions / total) * BAR_SQUARES)
  if (additions > 0 && green === 0) green = 1
  if (deletions > 0 && green === BAR_SQUARES) green = BAR_SQUARES - 1
  return Array.from({ length: BAR_SQUARES }, (_, i) => (i < green ? 'add' : 'del'))
}

// Files changed, and the lines added and removed, of the files whose lines are known.
export function summarize(files: readonly DiffFile[]): { files: number; additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const file of files) {
    if (file.binary || file.truncated) continue
    additions += file.additions
    deletions += file.deletions
  }
  return { files: files.length, additions, deletions }
}

// A run of a line's text, and whether it differs from the line it is paired with.
export interface WordSegment {
  text: string
  changed: boolean
}

const TOKEN = /\s+|\w+|[^\s\w]/g
// Past this many tokens on a side the table of the comparison grows for no gain; such a line gets no word marks.
const MAX_TOKENS = 300
// Lines that share less than this part of their characters are rewrites, and marking every word in them is noise.
const MIN_SHARED = 0.4

// The words that differ between a deleted line and the added line that replaced it, or null when the lines are too unlike (or too long) to
// compare. Tokens are words, runs of space and single marks; the longest common run of tokens stays plain, the rest is changed.
export function wordDiff(before: string, after: string): { before: WordSegment[]; after: WordSegment[] } | null {
  const a = before.match(TOKEN) ?? []
  const b = after.match(TOKEN) ?? []
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null
  const width = b.length + 1
  const table = new Uint16Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  const left: boolean[] = a.map(() => true)
  const right: boolean[] = b.map(() => true)
  let shared = 0
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      left[i] = right[j] = false
      if (!/^\s/.test(a[i])) shared += a[i].length
      i++
      j++
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++
    else j++
  }
  const size = (text: string): number => text.replace(/\s+/g, '').length
  if (shared === 0 || shared < MIN_SHARED * Math.max(size(before), size(after)) || (!left.includes(true) && !right.includes(true))) return null
  return { before: segments(a, left), after: segments(b, right) }
}

function segments(tokens: string[], changed: boolean[]): WordSegment[] {
  const out: WordSegment[] = []
  tokens.forEach((text, i) => {
    const last = out[out.length - 1]
    if (last && last.changed === changed[i]) last.text += text
    else out.push({ text, changed: changed[i] })
  })
  return out
}

// Word marks for every line of a hunk: in a run of deleted lines followed by a run of added lines, the first deleted line pairs with the
// first added line, and so on. Unpaired lines, context lines and unlike pairs are null.
export function lineWords(lines: readonly DiffLine[]): Array<WordSegment[] | null> {
  const out: Array<WordSegment[] | null> = lines.map(() => null)
  for (let i = 0; i < lines.length; ) {
    if (lines[i].kind !== 'del') {
      i++
      continue
    }
    let delEnd = i
    while (delEnd < lines.length && lines[delEnd].kind === 'del') delEnd++
    let addEnd = delEnd
    while (addEnd < lines.length && lines[addEnd].kind === 'add') addEnd++
    for (let k = 0; k < Math.min(delEnd - i, addEnd - delEnd); k++) {
      const pair = wordDiff(lines[i + k].text, lines[delEnd + k].text)
      if (pair) [out[i + k], out[delEnd + k]] = [pair.before, pair.after]
    }
    i = addEnd
  }
  return out
}

export interface BaseRefs {
  branches: string[]
  current: string | null
  default: string | null
}
// ref null: the detected default branch, which keeps being detected.
export interface BaseChoice {
  ref: string | null
  name: string
  kind: 'default' | 'recent' | 'match'
}

// What the picker lists. No query: the default branch, then recents that still exist (never the current branch, no duplicates). A query:
// the default if it matches, then every local or remote branch whose name contains it, case-insensitively, minus the current branch.
export function baseChoices(refs: BaseRefs, recents: readonly string[], query: string): BaseChoice[] {
  const def: BaseChoice[] = refs.default ? [{ ref: null, name: refs.default, kind: 'default' }] : []
  const q = query.trim().toLowerCase()
  if (!q) {
    const out: BaseChoice[] = [...def]
    for (const recent of recents) {
      if (recent === refs.current || recent === refs.default || !refs.branches.includes(recent) || out.some((c) => c.ref === recent)) continue
      out.push({ ref: recent, name: recent, kind: 'recent' })
      if (out.length - def.length === MAX_RECENT_BASES) break
    }
    return out
  }
  const matches = refs.branches
    .filter((b) => b !== refs.current && b !== refs.default && b !== `origin/${refs.default}` && b.toLowerCase().includes(q))
    .map((b): BaseChoice => ({ ref: b, name: b, kind: 'match' }))
  return [...def.filter((c) => c.name.toLowerCase().includes(q)), ...matches]
}

export interface EmptyMessage {
  text: string
  switchTo: { mode: DiffMode; label: string }
}

const SWITCH_LABEL: Record<DiffMode, string> = { branch: 'Show branch changes', uncommitted: 'Show uncommitted only', 'last-commit': 'Show last commit' }
const quick = (mode: DiffMode): EmptyMessage['switchTo'] => ({ mode, label: SWITCH_LABEL[mode] })

// What to say when a mode has no files, and the mode the quick-switch link goes to.
export function emptyMessage(compared: DiffCompared | null, mode: DiffMode): EmptyMessage {
  // The Branch mode is the uncommitted mode when there is no branch to compare against.
  const degenerate = !!compared && !compared.base && (compared.onDefault || compared.noDefault)
  if (mode === 'last-commit') {
    return compared?.noOwnCommits
      ? { text: 'No commits on this branch yet.', switchTo: quick('uncommitted') }
      : { text: 'No commits to show.', switchTo: quick('uncommitted') }
  }
  if (mode === 'uncommitted' || degenerate) {
    return { text: 'No uncommitted changes.', switchTo: quick(mode === 'uncommitted' && !degenerate ? 'branch' : 'last-commit') }
  }
  const target = compared?.base ?? compared?.defaultBase
  return { text: target ? `No changes on this branch compared to ${target}.` : 'No changes on this branch.', switchTo: quick('last-commit') }
}

// The note above the files when Branch mode has no main branch to compare against (the default pick, not an explicit branch).
export function branchNote(compared: DiffCompared | null): string | null {
  if (!compared || compared.mode !== 'branch' || compared.base) return null
  return compared.noDefault ? 'No main branch found; showing uncommitted changes only. Pick a branch to compare against.' : null
}

// An agent that stopped working has probably changed files: that is when the panel looks again.
export function settled(previous: AgentStateName | undefined, next: AgentStateName): boolean {
  return previous === 'working' && (next === 'idle' || next === 'needs-you' || next === 'finished')
}

export type CommentSide = DiffComment['side']

// A diff line takes comments on the side it lives on: a deleted line on the old side, an added or context line on the new side.
export function commentSide(line: DiffLine): { side: CommentSide; line: number } | null {
  if (line.kind === 'del') return line.old === null ? null : { side: 'old', line: line.old }
  return line.new === null ? null : { side: 'new', line: line.new }
}

export const commentKey = (path: string, side: CommentSide, line: number): string => `${path}\n${side}:${line}`

// The lines a comment from `first` to `last` (hunk indexes, either order) covers: those of the side of `first`. A context line is on both
// sides; a deleted line only on the old one, an added line only on the new one. Null: `first` has no line to comment on.
export function commentRange(lines: readonly DiffLine[], first: number, last: number): { side: CommentSide; line: number; endLine?: number; indexes: number[] } | null {
  const target = commentSide(lines[first])
  if (!target) return null
  const [from, to] = first <= last ? [first, last] : [last, first]
  const onSide = (candidate: DiffLine): boolean => candidate.kind !== (target.side === 'old' ? 'add' : 'del')
  const indexes: number[] = []
  for (let i = from; i <= to; i++) if (onSide(lines[i])) indexes.push(i)
  const start = commentSide(lines[indexes[0]])
  const end = commentSide(lines[indexes[indexes.length - 1]])
  if (!start || !end) return null
  return { side: target.side, line: start.line, ...(end.line === start.line ? {} : { endLine: end.line }), indexes }
}

// What the core keeps with a comment: the text of its lines (joined with a newline) and up to two lines of its side before and after it,
// inside the hunk. `indexes` is from commentRange.
export function commentContext(lines: readonly DiffLine[], indexes: readonly number[]): { anchor: string; before: string[]; after: string[] } {
  const cut = (text: string): string => text.slice(0, DIFF_COMMENT_LIMITS.line)
  const first = indexes[0]
  const last = indexes[indexes.length - 1]
  const target = commentSide(lines[first])
  const sameSide = (candidate: DiffLine): boolean => target !== null && candidate.kind !== (target.side === 'old' ? 'add' : 'del')
  const before = lines.slice(0, first).filter(sameSide).slice(-DIFF_COMMENT_LIMITS.context)
  const after = lines.slice(last + 1).filter(sameSide).slice(0, DIFF_COMMENT_LIMITS.context)
  return { anchor: indexes.map((i) => cut(lines[i].text)).join('\n'), before: before.map((l) => cut(l.text)), after: after.map((l) => cut(l.text)) }
}

// The last line of a comment, where its thread is drawn. A core from before ranges dropped `endLine` and kept the anchor of all the lines, so
// without it the end is the line count of the anchor.
export const commentEnd = (comment: Pick<DiffComment, 'line' | 'endLine' | 'anchor'>): number => comment.endLine ?? comment.line + comment.anchor.split('\n').length - 1

// `path:line`, or `path:line-endLine`, and `(old)` for the old side.
export function commentWhere(comment: DiffComment): string {
  return `${comment.path}:${comment.line}${commentEnd(comment) === comment.line ? '' : `-${commentEnd(comment)}`}${comment.side === 'old' ? ' (old)' : ''}`
}

export interface PlacedComments {
  // The comments whose line is in the diff with the text they were written on, by commentKey.
  inline: Map<string, DiffComment[]>
  // The others, by file path: the file is not in the diff, or the line at that position is not the same text any more.
  outdated: Map<string, DiffComment[]>
}

// Puts each comment where it was written, or among the outdated. A comment is never moved: it fits only at its own side and line number.
export function placeComments(files: readonly DiffFile[], comments: readonly DiffComment[]): PlacedComments {
  const texts = new Map<string, string>()
  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        const at = commentSide(line)
        if (at) texts.set(commentKey(file.path, at.side, at.line), line.text.slice(0, DIFF_COMMENT_LIMITS.line))
      }
    }
  }
  const inline = new Map<string, DiffComment[]>()
  const outdated = new Map<string, DiffComment[]>()
  const push = (map: Map<string, DiffComment[]>, key: string, comment: DiffComment): void => void map.set(key, [...(map.get(key) ?? []), comment])
  for (const comment of comments) {
    // Every line of the range must be there with its text, one by one.
    const wanted = comment.anchor.split('\n')
    const fits = wanted.length === commentEnd(comment) - comment.line + 1 && wanted.every((text, i) => texts.get(commentKey(comment.path, comment.side, comment.line + i)) === text)
    if (fits) push(inline, commentKey(comment.path, comment.side, commentEnd(comment)), comment)
    else push(outdated, comment.path, comment)
  }
  return { inline, outdated }
}

// How long ago, for a thread's head.
export function relativeTime(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / 86400)} d ago`
}

export const COMMENT_STATE_LABEL: Record<DiffComment['state'], string> = { pending: 'Pending', sent: 'Sent', resolved: 'Resolved' }

// The tab a send would go to, as the window knows it. `kind` is the agent, or shell for a terminal.
export interface SendTarget {
  name: string
  kind: 'shell' | AgentKind
  state: AgentStateName
  reason?: NeedsYouReason
  // The tab's process is gone.
  exited: boolean
}

export const NO_PENDING = 'No pending comments'

export interface SendState {
  label: string
  // Why the button is disabled; null when it can send.
  reason: string | null
  // Said after a send when the agent is busy.
  notice: string | null
}

// What the Send button shows and whether it can be pressed. A prompt or a question in the agent could take the pasted text as its answer.
export function sendState(pending: number, target: SendTarget | null, connected: boolean): SendState {
  const agent = target && target.kind !== 'shell' && !target.exited ? target.kind : null
  const label = agent && target ? `Send${pending > 0 ? ` ${pending}` : ''} to ${agent} · ${target.name}` : 'Send to agent'
  const waiting = target?.state === 'needs-you' && target.reason !== 'error'
  const notice = agent && target?.state === 'working' ? `${agent} is working; the text is waiting in its input` : null
  if (!connected) return { label, reason: 'The core is not connected', notice }
  if (!agent) return { label, reason: 'This tab has no agent', notice }
  if (waiting) return { label, reason: `${agent} is waiting for an answer`, notice }
  if (pending === 0) return { label, reason: NO_PENDING, notice }
  return { label, reason: null, notice }
}
