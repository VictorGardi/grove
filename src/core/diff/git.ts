import { execFile } from 'node:child_process'

export type GitRun = (args: string[], cwd: string) => Promise<string>

export class GitError extends Error {
  constructor(msg: string, readonly notRepo: boolean) {
    super(msg)
  }
}

// Runs the system git (ADR 0021). GIT_OPTIONAL_LOCKS=0: never take the index lock from under the agent.
export function gitRunner(gitPath: string, env: NodeJS.ProcessEnv): GitRun {
  const runEnv = { ...env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }
  return (args, cwd) => new Promise((resolve, reject) => {
    execFile(gitPath, ['-c', 'core.quotePath=false', ...args],
      { cwd, env: runEnv, timeout: 10_000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout)
        const e = err as NodeJS.ErrnoException & { killed?: boolean }
        if (e.killed) return reject(new GitError('timed out', false))
        if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return reject(new GitError('diff too large', false))
        reject(new GitError(stderr.trim() || e.message, /not a git repository/i.test(stderr)))
      })
  })
}

// Every branch a new worktree could fork: local ones, then remote-tracking ones as `origin/x`,
// whatever is already fetched. A remote's HEAD is an alias for its default branch, not a branch.
export async function listBases(git: GitRun, root: string): Promise<string[]> {
  try {
    const out = await git(['for-each-ref', '--format=%(refname)', 'refs/heads/', 'refs/remotes/'], root)
    const refs = out.split('\n').map((r) => r.trim()).filter(Boolean)
    const local = refs.filter((r) => r.startsWith('refs/heads/')).map((r) => r.slice('refs/heads/'.length))
    const remote = refs.filter((r) => r.startsWith('refs/remotes/') && !r.endsWith('/HEAD')).map((r) => r.slice('refs/remotes/'.length))
    return [...local, ...remote]
  } catch {
    return []
  }
}

// The repo's default branch: origin's HEAD, or a local main/master. null when neither is found.
export async function defaultBranch(git: GitRun, root: string): Promise<string | null> {
  try {
    const ref = (await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root)).trim()
    const name = ref.replace(/^origin\//, '')
    return name || null
  } catch {
    for (const name of ['main', 'master']) {
      try {
        await git(['rev-parse', '--verify', '-q', `refs/heads/${name}`], root)
        return name
      } catch { /* try the next candidate */ }
    }
    return null
  }
}

// Where `ref` and `head` forked: diffing from there shows everything done since, committed or not.
// null when they share no history (or `ref` doesn't exist) — the caller falls back to `ref` itself.
export async function mergeBase(git: GitRun, root: string, ref: string, head: string): Promise<string | null> {
  try {
    return (await git(['merge-base', ref, head], root)).trim() || null
  } catch {
    return null
  }
}

// The default branch as something to diff against: the local branch, else `origin/<name>`. `name` is the
// detected branch name, `ref` null when neither exists. null when no default is detected at all.
export async function resolveDefaultBase(git: GitRun, root: string): Promise<{ name: string; ref: string | null } | null> {
  const name = await defaultBranch(git, root)
  if (!name) return null
  for (const ref of [name, `origin/${name}`]) {
    try {
      await git(['rev-parse', '--verify', '-q', `${ref}^{commit}`], root)
      return { name, ref }
    } catch { /* try the next spelling */ }
  }
  return { name, ref: null }
}

// The branch HEAD is on, or null when detached.
export async function currentBranch(git: GitRun, root: string): Promise<string | null> {
  try {
    return (await git(['symbolic-ref', '--short', '-q', 'HEAD'], root)).trim() || null
  } catch {
    return null
  }
}
