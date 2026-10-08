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

// Local branch names, for a "diff against" picker.
export async function listBranches(git: GitRun, root: string): Promise<string[]> {
  try {
    const out = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], root)
    return out.split('\n').map((s) => s.trim()).filter(Boolean)
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
