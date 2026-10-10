import type { Project, Session } from '@shared/types'

// A worktree is a Project of its own (ADR 0037); `worktreeOf` names the checkout it hangs
// under, which core derived from git when it registered the worktree. So the parent here is
// a hint for drawing, never a claim about which repo the worktree belongs to.
export interface RepoGroup {
  key: string          // 'g:' + the head project's id
  project: Project     // the checkout; the project itself when nothing claims it
  worktrees: Project[] // its worktrees, in config order
}

// Core only ever points a worktree at a project whose own `.git` is a directory, and only a
// checkout has one, so no project is claimed by another worktree and no project is claimed
// twice: every project is either a head or exactly one head's worktree.
export function repoGroups(projects: Project[]): RepoGroup[] {
  const ids = new Set(projects.map((p) => p.id))
  const heads = projects.filter((p) => !(p.worktreeOf && ids.has(p.worktreeOf)))
  return heads.map((project) => ({
    key: 'g:' + project.id,
    project,
    worktrees: projects.filter((p) => p.worktreeOf === project.id),
  }))
}

// The rows of the sidebar's visibility list: one per repo, counting every session in every
// one of its checkouts. A worktree is not a row of its own — the repo is what the human
// shows and hides, so a checkout cannot be singled out and quietly take its sessions away.
export function repoRows(projects: Project[], sessions: Session[]): { project: Project; sessions: number }[] {
  return repoGroups(projects).map(({ project, worktrees }) => {
    const inRepo = new Set([project.id, ...worktrees.map((w) => w.id)])
    return { project, sessions: sessions.filter((s) => inRepo.has(s.projectId)).length }
  })
}