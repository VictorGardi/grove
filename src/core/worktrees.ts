import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Result } from '@shared/ipc'
import type { GitRun } from './diff/git'

// One worktree in `git worktree list --porcelain`: a checkout of the repo that shares its
// object store with every other. `branch` is null when the worktree is on a detached HEAD.
export interface Worktree { path: string; branch: string | null; head: string | null; locked: boolean }

// Where a new worktree lives: ~/.grove/worktrees/<repo>/<branch>, outside the repo so the
// agent never shares the main checkout's working tree. The branch becomes one path segment,
// so anything that is not safe in a name is folded to `-`.
export function worktreePath(repo: string, branch: string, home: string = os.homedir()): string {
  return path.join(home, '.grove', 'worktrees', path.basename(repo), branch.replace(/[^A-Za-z0-9._-]+/g, '-'))
}

// A worktree of `repo` on a new `branch`, at `path`, submodules initialised. git itself
// refuses a branch that already exists or is checked out elsewhere; slice 2 probes
// `list` first to say so in our own words.
export async function add(o: { repo: string; branch: string; path: string; git: GitRun | null }): Promise<Result<{ path: string; branch: string }>> {
  if (!o.git) return { ok: false, error: 'no-git' }
  fs.mkdirSync(path.dirname(o.path), { recursive: true })
  try {
    await o.git(['worktree', 'add', '-b', o.branch, o.path], o.repo)
    await o.git(['submodule', 'update', '--init', '--recursive'], o.path) // a no-op without submodules
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  return { ok: true, data: { path: o.path, branch: o.branch } }
}

// Every worktree of `repo`, its own first. Blank-line separated blocks of `key value` lines.
export async function list(repo: string, git: GitRun): Promise<Worktree[]> {
  let out: string
  try {
    out = await git(['worktree', 'list', '--porcelain'], repo)
  } catch {
    return [] // not a repo, or git failed: nothing to nest
  }
  return out.split('\n\n').flatMap((block) => {
    const fields = new Map(block.split('\n').filter(Boolean).map((line) => {
      const at = line.indexOf(' ')
      return at < 0 ? [line, ''] as const : [line.slice(0, at), line.slice(at + 1)] as const
    }))
    const at = fields.get('worktree')
    if (!at) return []
    return [{
      path: at,
      branch: fields.get('branch')?.replace(/^refs\/heads\//, '') ?? null,
      head: fields.get('HEAD') ?? null,
      locked: fields.has('locked'),
    }]
  })
}