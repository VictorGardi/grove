import fs from 'node:fs'
import path from 'node:path'
import type { DiffFileContent, DiffMode } from '../../protocol/messages.ts'
import { MAX_FILE_BYTES } from './compute.ts'
import { runGit, type GitRun } from './git.ts'

const BINARY_SNIFF = 8000 // git's own heuristic: a NUL in the first 8000 bytes
const gone: DiffFileContent = { state: 'missing', text: null }

// A path from the repo root that stays inside it: no climbing, nothing absolute, no flag.
function safeRelative(file: string): boolean {
  if (file === '' || file.includes('\0') || file.startsWith('-') || path.isAbsolute(file)) return false
  return !file.split(/[\\/]/).includes('..')
}

const text = (buf: Buffer): DiffFileContent =>
  buf.subarray(0, BINARY_SNIFF).includes(0) ? { state: 'binary', text: null } : { state: 'ok', text: buf.toString('utf8') }

// A file as the diff shows its new side, for the preview: the working tree in 'branch' and 'uncommitted' mode, HEAD in 'last-commit'
// mode (the working tree may have moved on since). `file` is a path from the repo root, as the diff names it. Read only, and never
// outside the repo: a link, a path that climbs, a folder that is not a repo or a file that is not there all read as `missing`. Past
// the diff's own size cap it is `too-large`, and a file with a NUL byte is `binary`; neither has text. Never throws.
export async function readNewSide(o: { dir: string; mode: DiffMode; file: string; git?: GitRun }): Promise<DiffFileContent> {
  if (!safeRelative(o.file)) return gone
  const git = o.git ?? runGit
  try {
    const root = (await git(['rev-parse', '--show-toplevel'], o.dir)).trim()
    return o.mode === 'last-commit' ? await readHead(git, root, o.file) : await readWorkingTree(root, o.file)
  } catch {
    return gone
  }
}

async function readHead(git: GitRun, root: string, file: string): Promise<DiffFileContent> {
  // A regular file only: a link is a blob in git too, and its text is a path.
  const entry = await git(['--literal-pathspecs', 'ls-tree', '-z', 'HEAD', '--', file], root)
  if (!/^100(644|755) blob /.test(entry)) return gone
  const spec = `HEAD:${file}`
  if (Number((await git(['cat-file', '-s', spec], root)).trim()) > MAX_FILE_BYTES) return { state: 'too-large', text: null }
  return text(Buffer.from(await git(['cat-file', 'blob', spec], root), 'utf8'))
}

async function readWorkingTree(root: string, file: string): Promise<DiffFileContent> {
  const full = path.join(root, file)
  const stat = await fs.promises.lstat(full)
  if (!stat.isFile()) return gone
  const [realRoot, real] = await Promise.all([fs.promises.realpath(root), fs.promises.realpath(full)])
  if (!real.startsWith(realRoot + path.sep)) return gone // a folder on the way is a link out of the repo
  if (stat.size > MAX_FILE_BYTES) return { state: 'too-large', text: null }
  return text(await fs.promises.readFile(real))
}
