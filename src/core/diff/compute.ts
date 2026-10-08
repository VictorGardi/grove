import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isViewable } from '@shared/artifactUrl'
import type { DiffFile, Project, SessionDiff } from '@shared/types'
import { GitError, type GitRun } from './git'
import { parseUnifiedDiff, untrackedFile } from './parse'

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const MAX_UNTRACKED_READ = 200 // files read for lines; the rest are listed without
const MAX_FILE_BYTES = 1024 * 1024
const BINARY_SNIFF = 8000 // git's own heuristic: a NUL in the first 8000 bytes
const MAX_LINES = 20_000 // once passed, later files are listed without lines

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex')

// The session's repo diff against HEAD. `key` fingerprints git's raw output: equal keys, equal diff.
export async function computeDiff(o: { sessionId: string; dir: string; project: Project; git: GitRun | null }):
  Promise<{ key: string; diff: SessionDiff }> {
  const base: SessionDiff = { sessionId: o.sessionId, projectId: o.project.id, state: 'ok', error: null, root: null, files: [], truncated: false }
  const { git } = o
  try {
    if (!git) throw new Error('git not found')
    let root: string
    try {
      root = (await git(['rev-parse', '--show-toplevel'], o.dir)).trim()
    } catch (e) {
      if (e instanceof GitError && e.notRepo) return { key: 'not-git', diff: { ...base, state: 'not-git' } }
      throw e
    }
    const head = await git(['rev-parse', '--verify', '-q', 'HEAD'], root).then(() => 'HEAD', () => EMPTY_TREE) // no commits yet
    const raw = await git(['diff', head, '-M', '--no-color', '--no-ext-diff', '--no-relative', '--src-prefix=a/', '--dst-prefix=b/'], root)
    const names = (await git(['ls-files', '--others', '--exclude-standard', '-z'], root)).split('\0').filter(Boolean)
    const untracked = await readUntracked(root, names)
    const key = sha1([raw, ...names, ...untracked.stamps].join('\0'))
    const files = [...parseUnifiedDiff(raw, MAX_FILE_BYTES), ...untracked.files]
    setRendered(files, root, o.project.path)
    return { key, diff: { ...base, root, files, truncated: capLines(files) } }
  } catch (e) {
    const error = (e as Error).message
    return { key: `error:${error}`, diff: { ...base, state: 'error', error } }
  }
}

const real = (p: string) => {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

const posix = (rel: string) => rel.split(path.sep).join('/')

// Where a changed viewable file opens rendered (D6): its path in the project folder. Dot segments
// (.github/…) are refused by the viewer, so they get none.
function setRendered(files: DiffFile[], root: string, projectPath: string): void {
  const project = real(projectPath)
  for (const file of files) {
    if (file.status === 'deleted' || !isViewable(file.path)) continue
    const rel = project && path.relative(project, path.join(root, file.path))
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.split(path.sep).some((seg) => seg.startsWith('.'))) {
      file.rendered = { path: posix(rel) }
    }
  }
}

// Past MAX_LINES in total, later files lose their lines. true: something was cut.
function capLines(files: DiffFile[]): boolean {
  let total = 0
  let cut = false
  for (const f of files) {
    if (total < MAX_LINES) total += f.hunks.reduce((n, h) => n + h.lines.length, 0)
    else if (f.hunks.length > 0) {
      Object.assign(f, { hunks: [], truncated: true })
      cut = true
    }
  }
  return cut
}

// Untracked files as all-added; `stamps` (size and mtime of each file looked at) feed the key.
async function readUntracked(root: string, names: string[]): Promise<{ files: DiffFile[]; stamps: string[] }> {
  const files: DiffFile[] = []
  const stamps: string[] = []
  for (const [i, name] of names.entries()) {
    if (i >= MAX_UNTRACKED_READ) {
      files.push(untrackedFile(name, null, true))
      continue
    }
    try {
      const file = path.join(root, name)
      const st = await fs.promises.lstat(file)
      stamps.push(`${st.size}:${st.mtimeMs}`)
      if (!st.isFile()) files.push(untrackedFile(name, null, false, true)) // a symlink: not followed
      else if (st.size > MAX_FILE_BYTES) files.push(untrackedFile(name, null, true))
      else {
        const buf = await fs.promises.readFile(file)
        files.push(buf.subarray(0, BINARY_SNIFF).includes(0)
          ? untrackedFile(name, null, false, true)
          : untrackedFile(name, buf.toString('utf8'), false))
      }
    } catch {
      stamps.push('gone') // deleted since ls-files
    }
  }
  return { files, stamps }
}
