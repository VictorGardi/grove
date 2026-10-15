import type { Project } from '@shared/types'
import { score } from './launchRank'

// What a repo's HEAD is on, and what a fork of it would branch from.
// `bases` is every branch a fork could start from, local or already fetched.
export interface RepoRefs { branch: string | null; default: string | null; bases?: string[] }
export type RefsByRepo = Record<string, RepoRefs>

// A row in the launch picker. Creating and opening are the same kind of thing here: `create`
// carries the repo to fork and the base it forks from, so the button can name what it will do.
// `branch` is a name the human already typed into the search; null means "propose one".
export type Row =
  | { type: 'create'; key: string; repo: Project; base: string | null; branch: string | null; label: string }
  | { type: 'existing'; key: string; project: Project }

export const repoOf = (p: Project): string => p.worktreeOf ?? p.id

// The repo the dialog was opened from comes first, so ⌘⇧T lands where ⌘T would have.
export function orderProjects(projects: Project[], openedFrom: string | undefined): Project[] {
  const first = openedFrom ? repoOf(projects.find((p) => p.id === openedFrom) ?? { id: openedFrom } as Project) : undefined
  return [...projects.filter((p) => repoOf(p) === first), ...projects.filter((p) => repoOf(p) !== first)]
}

// Create-first while the query is empty, matches after. Typing a name nobody has used is how you
// create one, so that name becomes the top row rather than a "create" entry to be found.
export function buildRows(ordered: Project[], refs: RefsByRepo, query: string): Row[] {
  const all: Row[] = []
  for (const p of ordered) {
    const base = refs[repoOf(p)]?.default ?? refs[repoOf(p)]?.branch ?? null
    all.push({
      type: 'create', key: `new:${repoOf(p)}`, repo: p, base, branch: null,
      label: base ? `New worktree from ${base}` : 'New worktree',
    })
    all.push({ type: 'existing', key: `use:${p.id}`, project: p })
  }
  const textOf = (r: Row) => (r.type === 'create'
    ? `${r.label} ${r.repo.name}`
    : `${r.project.name} ${refs[repoOf(r.project)]?.branch ?? ''}`)
  const ranked = all
    .map((r) => ({ r, s: score(query, textOf(r)) }))
    .filter((x): x is { r: Row; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r)

  const name = query.trim()
  const repo = ordered[0]
  if (!name || !repo) return ranked
  if (ranked.some((r) => r.type === 'existing' && refs[repoOf(r.project)]?.branch === name)) return ranked
  const base = refs[repoOf(repo)]?.default ?? null
  const typed: Row = {
    type: 'create', key: `new:${repoOf(repo)}:${name}`, repo, base, branch: name,
    label: `New worktree from ${base ?? 'HEAD'}: ${name}`,
  }
  return [typed, ...ranked]
}

// A branch we can propose but not guess: the repo's own name and the lowest free number.
export function suggestBranch(repo: Project, projects: Project[]): string {
  const slug = repo.name.replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase()
  const taken = new Set(projects.map((p) => p.name.split(' · ').pop() ?? ''))
  let n = 1
  while (taken.has(`${slug}-${n}`)) n++
  return `${slug}/${slug}-${n}`
}

// The branch a create row will make: what was typed into the branch field, else what the search
// carried, else a proposal. Whitespace can't be in a ref, so it becomes a dash.
export function branchFor(row: Extract<Row, { type: 'create' }>, edited: string | null, projects: Project[]): string {
  const raw = (edited ?? row.branch ?? '').trim().replace(/\s+/g, '-')
  return raw || suggestBranch(row.repo, projects)
}
