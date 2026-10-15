import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Result } from '@shared/ipc'
import { defaultBranch, type GitRun } from './diff/git'
import { realPath } from './git'

// One worktree in `git worktree list --porcelain`: a checkout of the repo that shares its
// object store with every other. `branch` is null when the worktree is on a detached HEAD.
export interface Worktree { path: string; branch: string | null; head: string | null; locked: boolean }

// One path segment per branch, so anything that is not safe in a name is folded to `-`.
const branchSegment = (branch: string) => branch.replace(/[^A-Za-z0-9._-]+/g, '-')

// Where a new worktree lives: ~/.grove/worktrees/<repo>/<branch>, outside the repo so the
// agent never shares the main checkout's working tree. `home` is a home directory, as it always
// has been; see `worktreePathIn` for rooting the layout somewhere else.
export function worktreePath(repo: string, branch: string, home: string = os.homedir()): string {
  return path.join(home, '.grove', 'worktrees', path.basename(repo), branchSegment(branch))
}

// The same <repo>/<branch> layout, but rooted at `root` instead of inside a home. Separate from
// `worktreePath` rather than a different meaning for its third argument: both are strings, so
// re-purposing one would let a caller that means "a home" get a layout it never asked for, with
// nothing to fail loudly. `worktreeCreate` uses this so a test can keep new checkouts out of the
// real ~/.grove.
export function worktreePathIn(root: string, repo: string, branch: string): string {
  return path.join(root, path.basename(repo), branchSegment(branch))
}

// A worktree of `repo` on a new `branch`, at `path`, submodules initialised. git itself
// refuses a branch that already exists or is checked out elsewhere; `conflict` says so first,
// in our own words and with the worktree to go to. It forks `base` (a branch, local or remote, or
// any commit-ish already fetched); without one it forks the checkout's HEAD, as git does.
export async function add(o: { repo: string; branch: string; path: string; base?: string; git: GitRun | null }): Promise<Result<{ path: string; branch: string }>> {
  if (!o.git) return { ok: false, error: 'no-git' }
  const blocked = await conflict(o.repo, o.branch, o.path, o.git)
  if (blocked) return { ok: false, error: blocked }
  let start: string | null = null
  if (o.base) {
    start = await resolveBase(o.repo, o.base, o.git)
    if (!start) return { ok: false, error: `base ${o.base} does not exist in ${o.repo}` }
  }
  fs.mkdirSync(path.dirname(o.path), { recursive: true })
  try {
    await o.git(['worktree', 'add', '-b', o.branch, o.path, ...(start ? [start] : [])], o.repo)
    await o.git(['submodule', 'update', '--init', '--recursive'], o.path) // a no-op without submodules
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  return { ok: true, data: { path: o.path, branch: o.branch } }
}

// What a base names, or null. A local branch or any commit-ish as typed; failing that the same
// name on origin, because a default branch that was only ever fetched has no local ref and
// `origin/HEAD` reports it bare. Nothing is fetched: this is whatever the repo already has.
async function resolveBase(repo: string, base: string, git: GitRun): Promise<string | null> {
  for (const candidate of [base, `origin/${base}`]) {
    try {
      await git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], repo)
      return candidate
    } catch {
      // try the next spelling
    }
  }
  return null
}

// Why this worktree cannot be made, or null. The first two come from `worktree list`, so a
// conflict is a sentence naming the other checkout instead of git's raw `fatal`; the third is
// the branch existing with no checkout at all, which is what a sanitised branch name can collide
// with (`feat/auth/login` and `feat-auth-login` both land in the same folder).
async function conflict(repo: string, branch: string, at: string, git: GitRun): Promise<string | null> {
  const all = await list(repo, git)
  const held = all.find((w) => w.branch === branch)
  if (held) return `branch ${branch} is already checked out at ${held.path}`
  const there = all.find((w) => realPath(w.path) === realPath(at))
  if (there) return `${at} is already a worktree of ${repo}${there.branch ? ` on ${there.branch}` : ''}`
  try {
    await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repo)
    return `branch ${branch} already exists in ${repo}`
  } catch {
    return null // no such branch: nothing conflicts
  }
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

// `lock` marks a worktree so `git worktree prune` and `gc` leave it alone — what a session
// running in it needs. `unlock` gives it back. Both best-effort: a caller is never waiting on
// git here, so a refusal is reported, not thrown.
export async function lock(repo: string, at: string, git: GitRun, reason?: string): Promise<boolean> {
  return run(repo, ['worktree', 'lock', ...(reason ? ['--reason', reason] : []), at], git)
}

export async function unlock(repo: string, at: string, git: GitRun): Promise<boolean> {
  return run(repo, ['worktree', 'unlock', at], git)
}

// Drops git's admin entry for the worktrees whose directory is gone. Locked ones are kept, which
// is the whole point of locking: a checkout an agent is still using is never pruned.
export async function prune(repo: string, git: GitRun): Promise<boolean> {
  return run(repo, ['worktree', 'prune'], git)
}

export async function remove(repo: string, at: string, git: GitRun): Promise<Result<{ path: string }>> {
  try {
    // No --force: git refuses a worktree with uncommitted work or a live lock, and that refusal
    // is the answer. Removing one is the human's call, not grove's.
    await git(['worktree', 'remove', at], repo)
    return { ok: true, data: { path: at } }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// The worktrees whose branch is in the repo's default branch, and so hold nothing that is not
// already in the checkout: what "clean up merged" offers. Never the checkout itself, and never a
// detached HEAD, which has no branch to compare.
export async function merged(repo: string, git: GitRun): Promise<Worktree[]> {
  const base = await defaultBranch(git, repo)
  if (!base) return []
  const out: Worktree[] = []
  for (const w of await list(repo, git)) {
    if (!w.branch || isCheckout(w.path)) continue
    try {
      await git(['merge-base', '--is-ancestor', `refs/heads/${w.branch}`, base], repo)
      out.push(w)
    } catch {
      // not merged
    }
  }
  return out
}

// The repo's own checkout, as opposed to a linked worktree: only a checkout has a `.git`
// directory, where a worktree has a file naming the gitdir it shares. Told this way rather than
// by comparing paths, it holds however the caller spells `repo` — and a checkout's own branch is
// trivially an ancestor of itself, so getting this wrong would offer to delete the checkout.
function isCheckout(at: string): boolean {
  try {
    return fs.statSync(path.join(at, '.git')).isDirectory()
  } catch {
    return false // no .git, or it is a worktree's redirect file
  }
}

async function run(repo: string, args: string[], git: GitRun): Promise<boolean> {
  try {
    await git(args, repo)
    return true
  } catch {
    return false
  }
}