import type { Project } from '@shared/types'
import { score } from './launchRank'
import { orderProjects, repoOf, type RefsByRepo } from './launchRows'

// A row of the ⌘T launcher. Rows are *where* a session goes; which agent runs there is a separate
// switch, so three kinds do not multiply every row by three.
//   checkout — a repo or one of its worktrees, run in as it is
//   create   — a new worktree of `repo`, forked from `base`; `branch` is what the human typed, or
//              null while nothing is typed (the launcher then proposes a name)
export type Target =
  | { type: 'checkout'; key: string; project: Project; repo: Project; branch: string | null; worktree: boolean }
  | { type: 'create'; key: string; repo: Project; base: string | null; branch: string | null }

// A ref cannot hold whitespace, so a typed name with any becomes dashes.
export const branchName = (raw: string): string => raw.trim().replace(/\s+/g, '-')

// A worktree project is named `<repo> · <branch>`; the branch is the part worth reading.
export const worktreeBranch = (p: Project): string => p.name.split(' · ').slice(1).join(' · ') || p.name

// The home folder is noise on every path in the list.
export function tidyPath(path: string, max = 36): string {
  const home = path.replace(/^\/(?:Users|home)\/[^/]+/, '~')
  if (home.length <= max) return home
  // cut on a folder boundary: half a folder name reads as a different folder
  const tail = home.slice(home.length - max + 1)
  return `…${tail.slice(Math.max(tail.indexOf('/'), 0))}`
}

// The base a human picked for each repo, by repo id.
export type ChosenBases = Record<string, string>

// What a fork of `repo` branches from: the base the human picked, else its default branch, else
// whatever the repo is on right now, so a repo that only reports one still has a base to name.
export function baseOf(refs: RefsByRepo, repoId: string, chosen: ChosenBases = {}): string | null {
  const r = refs[repoId]
  return chosen[repoId] ?? r?.default ?? r?.branch ?? null
}

// The branches the base picker offers for `repo`, filtered and ranked by `query`. The default
// and the checked-out branch come first, since those are the usual answers; the rest keep git's
// order, locals before remotes. A remote branch that only repeats a local one under `origin/` is
// kept: they can point at different commits, and which one you fork matters.
export function baseChoices(refs: RefsByRepo, repoId: string, query: string): string[] {
  const r = refs[repoId]
  const first = [r?.default, r?.branch].filter((b): b is string => !!b)
  const all = [...new Set([...first, ...(r?.bases ?? [])])]
  const q = query.trim()
  if (!q) return all
  return all
    .map((b) => ({ b, s: score(q, b) }))
    .filter((x): x is { b: string; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.b)
}

// Empty query: every repo as a group — the repo, its worktrees, then a way to make another — with
// the repo the launcher was opened from first. A query turns the list flat and ranked, because the
// same box is both the filter and the name of a worktree nobody has made yet: the top row forks
// the first repo under that name, and every other repo offers the same at the bottom, so ↓ retargets.
export function buildTargets(projects: Project[], openedFrom: string | undefined, refs: RefsByRepo, query: string, chosen: ChosenBases = {}): Target[] {
  const ordered = orderProjects(projects, openedFrom)
  const repos = [...new Set(ordered.map(repoOf))]
    .map((id) => projects.find((p) => p.id === id))
    .filter((p): p is Project => !!p)

  const checkoutsOf = (repo: Project): Target[] => {
    const wts = ordered.filter((p) => p.worktreeOf === repo.id)
    return [repo, ...wts].map((p) => ({
      type: 'checkout' as const,
      key: `use:${p.id}`,
      project: p,
      repo,
      worktree: !!p.worktreeOf,
      branch: p.worktreeOf ? worktreeBranch(p) : refs[repo.id]?.branch ?? null,
    }))
  }
  const create = (repo: Project, branch: string | null): Target => ({
    type: 'create', key: `new:${repo.id}`, repo, base: baseOf(refs, repo.id, chosen), branch,
  })

  const name = branchName(query)
  if (!name) return repos.flatMap((repo) => [...checkoutsOf(repo), create(repo, null)])

  const ranked = repos.flatMap(checkoutsOf)
    .map((t) => ({ t, s: t.type === 'checkout' ? score(query.trim(), `${t.project.name} ${t.branch ?? ''}`) : null }))
    .filter((x): x is { t: Target; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t)
  // A repo that already has a checkout on exactly this branch cannot fork it again: git would
  // refuse, so the row is not offered rather than offered and failed.
  const taken = (repo: Project) => ranked.some((t) => t.type === 'checkout' && t.repo.id === repo.id && t.branch === name)
  const creates = repos.filter((r) => !taken(r)).map((r) => create(r, name))
  const [first, ...rest] = creates
  return [...(first ? [first] : []), ...ranked, ...rest]
}
