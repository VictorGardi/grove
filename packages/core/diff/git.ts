import { execFile } from 'node:child_process'

export type GitRun = (args: string[], cwd: string) => Promise<string>

export class GitError extends Error {
  constructor(
    message: string,
    readonly notRepo: boolean,
  ) {
    super(message)
  }
}

export const GIT_TIMEOUT_MS = 10_000

// Everything the diff panel asks git is a read, and a cloned repo's config must not run code through it: no fsmonitor, no hooks, no pager.
// They go before the subcommand, so callers pass the subcommand first. `diff` calls add --no-ext-diff and --no-textconv themselves.
const HARDENING = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.pager=cat', '-c', 'core.quotePath=false']

export const gitArgv = (args: string[]): string[] => [...HARDENING, ...args]

// GIT_OPTIONAL_LOCKS=0: never take the index lock from under an agent. A GIT_EXTERNAL_DIFF in the core's own environment is dropped too.
export function gitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { GIT_EXTERNAL_DIFF: _external, ...rest } = env
  return { ...rest, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_PAGER: 'cat' }
}

// Runs the system git with execFile and an args array, never through a shell, in `cwd`.
export const runGit: GitRun = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      gitArgv(args),
      { cwd, env: gitEnv(process.env), timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        const failure = error as NodeJS.ErrnoException & { killed?: boolean }
        if (failure.killed) return reject(new GitError('timed out', false))
        if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return reject(new GitError('diff too large', false))
        reject(new GitError(stderr.trim() || failure.message, /not a git repository/i.test(stderr)))
      },
    )
  })

// Every branch a diff could be taken since: local ones, then remote-tracking ones as `origin/x`, whatever is already fetched.
// A remote's HEAD is an alias for its default branch, not a branch.
export async function listBases(git: GitRun, root: string): Promise<string[]> {
  try {
    const out = await git(['for-each-ref', '--format=%(refname)', 'refs/heads/', 'refs/remotes/'], root)
    const refs = out.split('\n').map((ref) => ref.trim()).filter(Boolean)
    const local = refs.filter((ref) => ref.startsWith('refs/heads/')).map((ref) => ref.slice('refs/heads/'.length))
    const remote = refs.filter((ref) => ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')).map((ref) => ref.slice('refs/remotes/'.length))
    return [...local, ...remote]
  } catch {
    return []
  }
}

// The repo's default branch: origin's HEAD, or a local main/master. null when neither is found.
export async function defaultBranch(git: GitRun, root: string): Promise<string | null> {
  try {
    const ref = (await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root)).trim()
    return ref.replace(/^origin\//, '') || null
  } catch {
    for (const name of ['main', 'master']) {
      try {
        await git(['rev-parse', '--verify', '-q', `refs/heads/${name}`], root)
        return name
      } catch {
        // try the next candidate
      }
    }
    return null
  }
}

// Where `ref` and `head` forked: diffing from there shows everything done since, committed or not.
// null when they share no history (or `ref` does not exist): the caller falls back to `ref` itself.
export async function mergeBase(git: GitRun, root: string, ref: string, head: string): Promise<string | null> {
  try {
    return (await git(['merge-base', ref, head], root)).trim() || null
  } catch {
    return null
  }
}

// A base the caller named, as the commit it points at. Anything starting with `-` is refused before git sees it, and git is told where
// options end, so a base can never be read as a flag. Only the returned SHA goes into later calls.
export async function resolveBase(git: GitRun, root: string, base: string): Promise<string> {
  if (base === '' || base.startsWith('-') || /[\0\n]/.test(base)) throw new GitError(`${JSON.stringify(base)} is not a valid base`, false)
  try {
    return (await git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], root)).trim()
  } catch {
    throw new GitError(`${base} is not a branch or commit in this repo`, false)
  }
}

// The default branch as something to diff against: the local branch, else `origin/<name>`. `name` is the
// detected branch name, `ref` null when neither exists. null when no default is detected at all.
export async function resolveDefaultBase(git: GitRun, root: string): Promise<{ name: string; ref: string | null } | null> {
  const name = await defaultBranch(git, root)
  if (!name) return null
  for (const ref of [name, `origin/${name}`]) {
    try {
      await git(['rev-parse', '--verify', '-q', '--end-of-options', `${ref}^{commit}`], root)
      return { name, ref }
    } catch {
      // try the next spelling
    }
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
