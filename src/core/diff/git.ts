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
