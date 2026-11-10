import { execFile } from 'node:child_process'
import path from 'node:path'

export interface SpaceGitInfo {
  repoName: string | null
  mainPath: string | null
  branch: string | null
}

const NONE: SpaceGitInfo = { repoName: null, mainPath: null, branch: null }

// Asks git which worktree is the main one for `dir`, and which branch is checked out there.
// Never throws: a folder outside git, or a missing git, gives nulls. A detached HEAD gives a null branch.
export function spaceGitInfo(dir: string): Promise<SpaceGitInfo> {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, 'worktree', 'list', '--porcelain'], (error, stdout) => {
      if (error) return resolve(NONE)
      const line = stdout.split('\n').find((candidate) => candidate.startsWith('worktree '))
      if (!line) return resolve(NONE)
      const mainPath = line.slice('worktree '.length).trim()
      execFile('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], (branchError, branchOut) => {
        const name = branchError ? 'HEAD' : branchOut.trim()
        const branch = name === '' || name === 'HEAD' ? null : name
        resolve({ repoName: path.basename(mainPath), mainPath, branch })
      })
    })
  })
}

export interface WorktreeEntry {
  path: string
  // The checked-out branch; null when detached or bare.
  branch: string | null
}

// Runs git in `dir`. A failure carries git's own message, which is what the human needs to read.
function git(dir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', dir, ...args], (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr.trim() || error.message))
      resolve(stdout)
    })
  })
}

// Every worktree of the repo `dir` belongs to, the main one first. Rejects when `dir` is not in a repo.
export async function listWorktrees(dir: string): Promise<WorktreeEntry[]> {
  const out = await git(dir, ['worktree', 'list', '--porcelain'])
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
async function resolveCommit(dir: string, ref: string): Promise<string> {
  const notValid = () => new Error(`not a valid base: ${ref}`)
  if (ref.startsWith('-')) throw notValid()
  const sha = await git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => {
    throw notValid()
  })
  return sha.trim()
}

// Adds a worktree at `dest`. A branch that exists is checked out; a new one starts from `base`, else `dir`'s HEAD.
export async function addWorktree(dir: string, dest: string, branch: string, base?: string): Promise<void> {
  await git(dir, ['check-ref-format', '--branch', branch]).catch(() => {
    throw new Error(`not a valid branch name: ${branch}`)
  })
  const exists = await git(dir, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).then(
    () => true,
    () => false,
  )
  if (exists && base !== undefined) throw new Error(`branch ${branch} exists, base only applies to a new branch`)
  // A base is resolved to a commit first, so a value git would read as an option or a bad ref fails with a clear message.
  const start = base === undefined ? 'HEAD' : await resolveCommit(dir, base)
  await git(dir, exists ? ['worktree', 'add', dest, branch] : ['worktree', 'add', '-b', branch, dest, start])
}

// Removes the checkout. Git refuses a checkout with changes in it or a lock, unless `force`; the branch is kept. A locked
// checkout needs --force twice (the old Grove locks the ones it has a session in), and force is only asked for after the human
// confirmed it.
export async function removeWorktree(dir: string, worktree: string, force = false): Promise<void> {
  await git(dir, ['worktree', 'remove', ...(force ? ['--force', '--force'] : []), worktree])
}
