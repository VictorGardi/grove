import fs from 'node:fs'
import path from 'node:path'
import type { DiffCompared, DiffFile, DiffMode, DiffResult } from '../../protocol/messages.ts'
import { currentBranch, GitError, mergeBase, resolveBase, resolveDefaultBase, runGit, type GitRun } from './git.ts'
import { parseUnifiedDiff, untrackedFile } from './parse.ts'

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const MAX_UNTRACKED_READ = 200 // files read for lines; the rest are listed without
export const MAX_FILE_BYTES = 1024 * 1024
const BINARY_SNIFF = 8000 // git's own heuristic: a NUL in the first 8000 bytes
export const MAX_LINES = 20_000 // once passed, later files are listed without lines

export const noCompared = (mode: DiffMode = 'branch'): DiffCompared => ({
  mode,
  base: null,
  defaultBase: null,
  onDefault: false,
  noDefault: false,
  noOwnCommits: false,
})

const DIFF_FLAGS = ['-M', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative', '--src-prefix=a/', '--dst-prefix=b/']

// A repo can name a filter in .gitattributes and a command for it in its config, and `git diff` runs a file's clean filter when it reads
// the working tree. Every configured filter command is blanked for the call, so nothing the repo configured runs.
async function filterOverrides(git: GitRun, root: string): Promise<string[]> {
  const out = await git(['config', '--get-regexp', '^filter\\..+\\.(clean|smudge|process)$'], root).catch(() => '')
  const keys = new Set(out.split('\n').map((line) => line.split(' ')[0]).filter(Boolean))
  return [...keys].flatMap((key) => ['-c', `${key}=`])
}

// The folder's repo diff, plus untracked files. In 'branch' mode (the default) against where HEAD forked from `base`, else from the
// detected main branch, so committed-but-unpushed work shows; on the main branch, or with none found, against HEAD. 'uncommitted':
// against HEAD (an explicit `base` is ignored). 'last-commit': HEAD against its parent (the empty tree for a root commit), tracked files
// only, nothing when the branch has no commits of its own. `counts` is left for diffAllModes to fill.
// Never throws: a folder outside git is state `not-git`, anything git refuses is state `error` with its message.
export async function computeDiff(o: {
  dir: string
  git?: GitRun
  mode?: DiffMode
  base?: string | null
  showUntracked?: boolean
}): Promise<DiffResult> {
  const mode = o.mode ?? 'branch'
  const git = o.git ?? runGit
  const empty: DiffResult = {
    state: 'ok',
    error: null,
    root: null,
    files: [],
    truncated: false,
    compared: noCompared(mode),
    counts: { branch: 0, uncommitted: 0, 'last-commit': 0 },
  }
  const explicitBase = mode === 'branch' ? (o.base ?? null) : null
  try {
    let root: string
    try {
      root = (await git(['rev-parse', '--show-toplevel'], o.dir)).trim()
    } catch (error) {
      if (error instanceof GitError && error.notRepo) return { ...empty, state: 'not-git' }
      throw error
    }
    const head = await git(['rev-parse', '--verify', '-q', 'HEAD'], root).then(
      () => 'HEAD',
      () => EMPTY_TREE, // no commits yet
    )
    const compared = noCompared(mode)
    let target: string | null = explicitBase === null ? null : await resolveBase(git, root, explicitBase) // the ref to fork from
    if (mode === 'branch' || mode === 'last-commit') {
      const def = await resolveDefaultBase(git, root)
      const branch = await currentBranch(git, root)
      compared.defaultBase = def?.name ?? null
      compared.noDefault = !def || !def.ref || !branch || head !== 'HEAD' // detached or unborn HEAD: nothing to fork from
      compared.onDefault = !!def && branch === def.name
      if (!explicitBase && def?.ref && !compared.onDefault && !compared.noDefault) target = def.ref
      compared.base = explicitBase ?? (target ? def!.name : null)
      if (mode === 'last-commit') target = !compared.onDefault && !compared.noDefault ? def!.ref : null // only to tell whether the branch has commits of its own
    }
    // merge-base needs a real HEAD commit; with none yet (or an unrelated history) diff the base ref's tip directly
    const fork = target ? (head === 'HEAD' ? await mergeBase(git, root, target, head) : null) : null
    const against = target ? (fork ?? target) : head
    // The folder can be a subtree of its repo (a monorepo package): scope the diff to it.
    const scope = folderScope(root, o.dir)
    if (target && !compared.onDefault && head === 'HEAD') compared.noOwnCommits = fork !== null && fork === (await git(['rev-parse', 'HEAD'], root)).trim()
    const overrides = await filterOverrides(git, root)
    const diffArgs = [...DIFF_FLAGS, ...scope]
    if (mode === 'last-commit') {
      compared.base = null
      const parent =
        head === 'HEAD' && !compared.noOwnCommits
          ? await git(['rev-parse', '--verify', '-q', 'HEAD~1'], root).then(
              () => 'HEAD~1',
              () => EMPTY_TREE,
            )
          : null
      const raw = parent ? await git([...overrides, 'diff', parent, 'HEAD', ...diffArgs], root) : ''
      const files = parseUnifiedDiff(raw, MAX_FILE_BYTES)
      return { ...empty, root, files, truncated: capLines(files), compared }
    }
    const raw = await git([...overrides, 'diff', against, ...diffArgs], root)
    const files = parseUnifiedDiff(raw, MAX_FILE_BYTES)
    if (o.showUntracked !== false) {
      const names = (await git(['ls-files', '--others', '--exclude-standard', '-z', ...scope], root)).split('\0').filter(Boolean)
      files.push(...(await readUntracked(root, names)))
    }
    return { ...empty, root, files, truncated: capLines(files), compared }
  } catch (error) {
    return { ...empty, state: 'error', error: error instanceof Error ? error.message : String(error) }
  }
}

// The result for `mode`, with how many files each mode shows. The other two modes are computed in full and kept only as counts.
export async function diffAllModes(o: { dir: string; git?: GitRun; mode: DiffMode; base?: string | null; showUntracked?: boolean }): Promise<DiffResult> {
  const modes: DiffMode[] = ['branch', 'uncommitted', 'last-commit']
  const results = await Promise.all(modes.map((mode) => computeDiff({ ...o, mode })))
  const counts = Object.fromEntries(modes.map((mode, i) => [mode, results[i].files.length])) as DiffResult['counts']
  return { ...results[modes.indexOf(o.mode)], counts }
}

const posix = (rel: string): string => rel.split(path.sep).join('/')

// Pathspec args restricting git to the folder's subtree, when it is one. None for a folder at the repo root. `dir` is a real path already.
function folderScope(root: string, dir: string): string[] {
  let real: string
  let top: string
  try {
    real = fs.realpathSync(dir)
    top = fs.realpathSync(root)
  } catch {
    return []
  }
  const rel = path.relative(top, real)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return []
  return ['--', posix(rel)]
}

// Past MAX_LINES in total, later files lose their lines. true: something was cut.
function capLines(files: DiffFile[]): boolean {
  let total = 0
  let cut = false
  for (const file of files) {
    if (total < MAX_LINES) total += file.hunks.reduce((n, hunk) => n + hunk.lines.length, 0)
    else if (file.hunks.length > 0) {
      Object.assign(file, { hunks: [], truncated: true })
      cut = true
    }
  }
  return cut
}

// Untracked files as all-added. A symlink is not followed, a binary or unreadable file is listed without lines.
async function readUntracked(root: string, names: string[]): Promise<DiffFile[]> {
  const files: DiffFile[] = []
  for (const [i, name] of names.entries()) {
    if (i >= MAX_UNTRACKED_READ) {
      files.push(untrackedFile(name, null, true))
      continue
    }
    try {
      const file = path.join(root, name)
      const stat = await fs.promises.lstat(file)
      if (!stat.isFile()) files.push(untrackedFile(name, null, false, true))
      else if (stat.size > MAX_FILE_BYTES) files.push(untrackedFile(name, null, true))
      else {
        const buf = await fs.promises.readFile(file)
        files.push(buf.subarray(0, BINARY_SNIFF).includes(0) ? untrackedFile(name, null, false, true) : untrackedFile(name, buf.toString('utf8'), false))
      }
    } catch {
      // deleted since ls-files
    }
  }
  return files
}
