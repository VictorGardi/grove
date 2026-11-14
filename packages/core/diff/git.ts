import { GitError, type GitRun } from '../gitrun.ts'

export { gitArgv, gitEnv, GitError, runGit, type GitRun } from '../gitrun.ts'

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
