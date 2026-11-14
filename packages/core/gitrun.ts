import { execFile, spawn } from 'node:child_process'

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

const failureOf = (stderr: string, message: string) => new GitError(stderr.trim() || message, /not a git repository/i.test(stderr))

// A write: its own process group, and a timeout kills the whole group, so a hook's children stop with git.
function runGitWrite(args: string[], cwd: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', gitArgv(args, 'write'), { cwd, env: gitEnv(process.env, 'write'), detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let expired = false
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
    const timer = setTimeout(() => {
      expired = true
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, timeout)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(failureOf('', error.message))
    })
    // 'close' waits for the pipes, which hook children hold open until the group is gone.
    child.on('close', (code) => {
      clearTimeout(timer)
      if (expired) return reject(new GitError('timed out', false, true))
      if (code === 0) return resolve(Buffer.concat(out).toString('utf8'))
      reject(failureOf(Buffer.concat(err).toString('utf8'), `git exited with ${code}`))
    })
  })
}

// Runs the system git with an args array, never through a shell, in `cwd`.
export const runGit: GitRun = (args, cwd, options = {}) => {
  const kind = options.kind ?? 'read'
  const timeout = options.timeoutMs ?? (kind === 'read' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS)
  if (kind === 'write') return runGitWrite(args, cwd, timeout)
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
        reject(failureOf(stderr, failure.message))
      },
    )
  })
}
