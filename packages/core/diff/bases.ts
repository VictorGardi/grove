import type { DiffBases } from '../../protocol/messages.ts'
import { currentBranch, defaultBranch, listBases, runGit, type GitRun } from './git.ts'

export const MAX_RECENT_BASES = 5

// The branches a folder's diff was recently compared against, newest first, after picking `base`.
export function pushRecentBase(recents: readonly string[], base: string): string[] {
  return [base, ...recents.filter((recent) => recent !== base)].slice(0, MAX_RECENT_BASES)
}

// What the base picker draws from. A folder outside git has nothing. `recents` is filled in by the caller, who keeps them.
export async function diffBases(dir: string, git: GitRun = runGit): Promise<Omit<DiffBases, 'recents'>> {
  let root: string
  try {
    root = (await git(['rev-parse', '--show-toplevel'], dir)).trim()
  } catch {
    return { branches: [], current: null, default: null }
  }
  const [branches, current, def] = await Promise.all([listBases(git, root), currentBranch(git, root), defaultBranch(git, root)])
  return { branches, current, default: def }
}
