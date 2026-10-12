import type { Project, Session } from '@shared/types'
import { canParent } from '@shared/sessionGroups'
import { repoGroups, repoHead } from './repoGroups'

// What the parent picker offers, one run per repo (a worktree's sessions count under their repo,
// as in the sidebar): the session's own repo first, then the others in project order. Repos with
// nothing to offer are left out.
export interface ParentRun { project: Project; sessions: Session[] }

export function parentOptions(projects: Project[], sessions: Session[], session: Session): ParentRun[] {
  const ownRepo = repoHead(projects, session.projectId)
  const runs = repoGroups(projects)
    .map(({ project }) => ({
      project,
      sessions: sessions.filter((x) => canParent(sessions, session.id, x) && repoHead(projects, x.projectId) === project.id),
    }))
    .filter((r) => r.sessions.length > 0)
  return [...runs.filter((r) => r.project.id === ownRepo), ...runs.filter((r) => r.project.id !== ownRepo)]
}
