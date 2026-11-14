import fs from 'node:fs'
import path from 'node:path'
import { GitError, runGit, type GitRun } from './gitrun.ts'

export interface SpaceGitInfo {
  repoName: string | null
  mainPath: string | null
  branch: string | null
}

const WRITE = { kind: 'write' } as const
const NONE: SpaceGitInfo = { repoName: null, mainPath: null, branch: null }

// Asks git which worktree is the main one for `dir`, and which branch is checked out there. Reads only. Rejects with the GitError
// when git cannot answer (check `notRepo` to tell a folder outside git from a timeout or other failure). An unborn branch shows its
// name, a detached HEAD gives null.
export async function readSpaceGit(dir: string, git: GitRun = runGit): Promise<SpaceGitInfo> {
  const list = await git(['worktree', 'list', '--porcelain'], dir)
  const line = list.split('\n').find((candidate) => candidate.startsWith('worktree '))
  if (!line) return NONE
  const mainPath = line.slice('worktree '.length).trim()
  // symbolic-ref -q exits 1 for a detached HEAD, which is a null branch; a timeout or a lost repo is not an answer.
  const branch = await git(['symbolic-ref', '--short', '-q', 'HEAD'], dir).then(
    (out) => out.trim() || null,
    (error: unknown) => {
      if (error instanceof GitError && (error.timedOut || error.notRepo)) throw error
      return null
    },
  )
  return { repoName: path.basename(mainPath), mainPath, branch }
}

// Never throws: a folder outside git, or a missing git, gives nulls.
export async function spaceGitInfo(dir: string, git: GitRun = runGit): Promise<SpaceGitInfo> {
  return readSpaceGit(dir, git).catch(() => NONE)
}

export interface WorktreeEntry {
  path: string
  // The checked-out branch; null when detached or bare.
  branch: string | null
}

// Every worktree of the repo `dir` belongs to, the main one first. Rejects when `dir` is not in a repo.
export async function listWorktrees(dir: string, git: GitRun = runGit): Promise<WorktreeEntry[]> {
  const out = await git(['worktree', 'list', '--porcelain'], dir)
  return out
    .split('\n\n')
    .map((block) => block.split('\n'))
    .filter((lines) => lines.some((line) => line.startsWith('worktree ')))
    .map((lines) => {
      const branch = lines.find((line) => line.startsWith('branch '))
      return {
        path: lines.find((line) => line.startsWith('worktree '))!.slice('worktree '.length),
        branch: branch === undefined ? null : branch.slice('branch refs/heads/'.length),
      }
    })
}

// The commit `ref` names. Refuses a ref that starts with `-`, which git would read as an option.
async function resolveCommit(git: GitRun, dir: string, ref: string): Promise<string> {
  const notValid = () => new Error(`not a valid base: ${ref}`)
  if (ref.startsWith('-')) throw notValid()
  const sha = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], dir).catch(() => {
    throw notValid()
  })
  return sha.trim()
}

const CLEANUP_TIMEOUT_MS = 30_000
const CANNOT_READ = "couldn't read git state, try again"

// Whether refs/heads/<branch> exists. Rejects when git cannot answer, so a failed read never passes for "missing".
async function branchExists(git: GitRun, dir: string, branch: string): Promise<boolean> {
  const ref = `refs/heads/${branch}`
  const out = await git(['for-each-ref', '--format=%(refname)', ref], dir)
  return out.split('\n').some((line) => line.trim() === ref)
}

// After a create timed out (git and its hooks are already killed): a checkout that is whole is kept, since only a hook was slow;
// anything else is removed, and so is the branch, but only a branch and a folder this create made. Returns what to tell the human.
async function cleanUpTimedOutCreate(git: GitRun, dir: string, dest: string, branch: string, made: { path: boolean; branch: boolean }): Promise<string> {
  const complete = await git(['status', '--porcelain'], dest).then(
    async (status) => status.trim() === '' && (await git(['symbolic-ref', '-q', 'HEAD'], dest).then((head) => head.trim() === `refs/heads/${branch}`, () => false)),
    () => false,
  )
  if (complete) return `the checkout is complete and was kept at ${dest}; only a hook was slow`
  const cleanup = { kind: 'write', timeoutMs: CLEANUP_TIMEOUT_MS } as const
  if (made.path) {
    await git(['worktree', 'remove', '-f', '-f', dest], dir, cleanup).catch(() => undefined)
    fs.rmSync(dest, { recursive: true, force: true })
  }
  await git(['worktree', 'prune'], dir, cleanup).catch(() => undefined)
  if (made.branch) await git(['branch', '-D', branch], dir, cleanup).catch(() => undefined)
  const left: string[] = []
  if (made.path && fs.existsSync(dest)) left.push(`the folder ${dest}`)
  if (made.branch && (await branchExists(git, dir, branch).catch(() => true))) left.push(`the branch ${branch}`)
  if (made.path && (await git(['worktree', 'list', '--porcelain'], dir).then((list) => list.split('\n').includes(`worktree ${dest}`), () => true))) left.push(`the worktree entry for ${dest}`)
  return left.length === 0 ? 'the half-made checkout was removed' : `cleanup failed, left behind: ${left.join(', ')}`
}

// Adds a worktree at `dest`. A branch that exists is checked out; a new one starts from `base`, else `dir`'s HEAD. A timeout
// rejects with a GitError (timedOut) whose message says what became of the half-made checkout. When git cannot say whether the
// branch exists, nothing is created, so a later cleanup never has to guess what was there before.
export async function addWorktree(dir: string, dest: string, branch: string, base?: string, git: GitRun = runGit): Promise<void> {
  await git(['check-ref-format', '--branch', branch], dir).catch(() => {
    throw new Error(`not a valid branch name: ${branch}`)
  })
  const exists = await branchExists(git, dir, branch).catch(() => {
    throw new Error(CANNOT_READ)
  })
  if (exists && base !== undefined) throw new Error(`branch ${branch} exists, base only applies to a new branch`)
  // A base is resolved to a commit first, so a value git would read as an option or a bad ref fails with a clear message.
  const start = base === undefined ? 'HEAD' : await resolveCommit(git, dir, base)
  const pathExisted = fs.existsSync(dest)
  try {
    await git(exists ? ['worktree', 'add', dest, branch] : ['worktree', 'add', '-b', branch, dest, start], dir, WRITE)
  } catch (error) {
    if (!(error instanceof GitError && error.timedOut)) throw error
    const outcome = await cleanUpTimedOutCreate(git, dir, dest, branch, { path: !pathExisted, branch: !exists }).catch(() => `cleanup could not run, check ${dest} and branch ${branch}`)
    throw new GitError(outcome, false, true)
  }
}

// Removes the checkout. Git refuses a checkout with changes in it or a lock, unless `force`; the branch is kept. A locked
// checkout needs --force twice (the old Grove locks the ones it has a session in), and force is only asked for after the human
// confirmed it.
export async function removeWorktree(dir: string, worktree: string, force = false, git: GitRun = runGit): Promise<void> {
  await git(['worktree', 'remove', ...(force ? ['--force', '--force'] : []), worktree], dir, WRITE)
}
