import { execFile } from 'node:child_process'

// How one git call runs. A read never runs a repo's hooks (a cloned repo's config must not run code in the background); a write
// keeps them, since a post-checkout install is expected. Both are English, prompt-free and without a file-watch command.
export interface GitOptions {
  kind?: 'read' | 'write'
  timeoutMs?: number
}

// `args` start with the subcommand; the runner puts its own hardening before it. `cwd` is where git runs.
export type GitRun = (args: string[], cwd: string, options?: GitOptions) => Promise<string>

export class GitError extends Error {
  constructor(
    message: string,
    readonly notRepo: boolean,
    readonly timedOut = false,
  ) {
    super(message)
  }
}

export const READ_TIMEOUT_MS = 10_000
export const WRITE_TIMEOUT_MS = 120_000

const READ_CONFIG = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.pager=cat', '-c', 'core.quotePath=false']
const WRITE_CONFIG = ['-c', 'core.fsmonitor=false', '-c', 'core.pager=cat']

export const gitArgv = (args: string[], kind: 'read' | 'write' = 'read'): string[] => [...(kind === 'read' ? READ_CONFIG : WRITE_CONFIG), ...args]

// GIT_OPTIONAL_LOCKS=0 (reads only): never take the index lock from under an agent. A GIT_EXTERNAL_DIFF in the core's own environment is dropped too.
export function gitEnv(env: NodeJS.ProcessEnv, kind: 'read' | 'write' = 'read'): NodeJS.ProcessEnv {
  const { GIT_EXTERNAL_DIFF: _external, ...rest } = env
  const base = { ...rest, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_PAGER: 'cat' }
  return kind === 'read' ? { ...base, GIT_OPTIONAL_LOCKS: '0' } : base
}

// Runs the system git with execFile and an args array, never through a shell, in `cwd`.
export const runGit: GitRun = (args, cwd, options = {}) => {
  const kind = options.kind ?? 'read'
  const timeout = options.timeoutMs ?? (kind === 'read' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS)
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      gitArgv(args, kind),
      { cwd, env: gitEnv(process.env, kind), timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        const failure = error as NodeJS.ErrnoException & { killed?: boolean }
        if (failure.killed) return reject(new GitError('timed out', false, true))
        if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return reject(new GitError('diff too large', false))
        reject(new GitError(stderr.trim() || failure.message, /not a git repository/i.test(stderr)))
      },
    )
  })
}
