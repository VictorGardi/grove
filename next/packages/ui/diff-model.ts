// What the diff panel decides before it draws: the tree of changed files, the base picker's choices, what to say when there is nothing to
// show, and when an agent's change of state is a reason to look again. Ported from old Grove's diffView.ts and diffBases.ts.
import type { AgentStateName, DiffCompared, DiffFile, DiffMode } from '../protocol/messages.ts'

export const MODE_LABEL: Record<DiffMode, string> = { branch: 'Branch', uncommitted: 'Uncommitted', 'last-commit': 'Last commit' }
export const MODES: readonly DiffMode[] = ['branch', 'uncommitted', 'last-commit']
export const MAX_RECENT_BASES = 5

export const STATUS_LETTER: Record<DiffFile['status'], string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: '?' }

// A row of the tree. `path` identifies it: the folder's path, or the file's.
export type TreeRow =
  | { kind: 'dir'; path: string; name: string; depth: number; collapsed: boolean; files: number }
  | { kind: 'file'; path: string; name: string; dir: string; depth: number; file: DiffFile }

interface Node {
  name: string
  path: string
  dirs: Map<string, Node>
  files: DiffFile[]
}

function countFiles(node: Node): number {
  let total = node.files.length
  for (const child of node.dirs.values()) total += countFiles(child)
  return total
}

// The files whose path contains `filter`, case-insensitively, as the rows the tree shows: folders first, then files, each by name.
// A folder that holds only one folder is joined with it (`packages/core`), so a deep path does not use the dock's width on indents.
// `collapsed` names folders shown shut. A filter opens every folder, so a match is never hidden.
export function treeRows(files: readonly DiffFile[], filter: string, collapsed: ReadonlySet<string>): TreeRow[] {
  const query = filter.trim().toLowerCase()
  const shown = query === '' ? files : files.filter((file) => file.path.toLowerCase().includes(query))
  const root: Node = { name: '', path: '', dirs: new Map(), files: [] }
  for (const file of shown) {
    const parts = file.path.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      const path = node.path === '' ? part : `${node.path}/${part}`
      let child = node.dirs.get(part)
      if (!child) node.dirs.set(part, (child = { name: part, path, dirs: new Map(), files: [] }))
      node = child
    }
    node.files.push(file)
  }
  const rows: TreeRow[] = []
  const walk = (node: Node, depth: number): void => {
    const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name)
    for (let dir of [...node.dirs.values()].sort(byName)) {
      let name = dir.name
      while (dir.files.length === 0 && dir.dirs.size === 1) {
        dir = [...dir.dirs.values()][0]
        name = `${name}/${dir.name}`
      }
      const shut = query === '' && collapsed.has(dir.path)
      rows.push({ kind: 'dir', path: dir.path, name, depth, collapsed: shut, files: countFiles(dir) })
      if (!shut) walk(dir, depth + 1)
    }
    const named = node.files.map((file) => ({ file, name: file.path.slice(file.path.lastIndexOf('/') + 1) })).sort(byName)
    for (const { file, name } of named) {
      rows.push({ kind: 'file', path: file.path, name, dir: file.path.slice(0, file.path.length - name.length), depth, file })
    }
  }
  walk(root, 0)
  return rows
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
