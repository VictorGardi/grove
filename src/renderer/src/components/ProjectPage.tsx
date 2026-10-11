import type { Feature, Project, Session, UiState } from '@shared/types'
import { unionFeatures } from '../featureUnion'
import { repoGroups, repoProjectIds } from '../repoGroups'
import { Board } from './Board'
import { SessionsBoard } from './SessionsBoard'
import s from './ProjectPage.module.css'

// The content area for one project: its features or sessions board (ADR 0018). A checkout's page
// is the repo's — every checkout's sessions, and one card per feature however many checkouts hold
// a copy of it (design D3). A worktree's page is that checkout's sessions and nothing else: the
// features board is repo-scoped, so it lives on the parent checkout's page, and ⌘B goes there.
export function ProjectPage({ project, projects, board, stages, features, sessions, onOpenFeature, onFocusSession }: {
  project: Project
  projects: Project[]
  board: UiState['board']
  stages: { id: string; label: string }[]
  features: Feature[] // all features; scoped to the repo here
  sessions: Session[] // all sessions; scoped to the repo here
  onOpenFeature(f: Feature): void
  onFocusSession(id: string): void
}) {
  const worktree = !!project.worktreeOf
  const scope = worktree ? new Set([project.id]) : repoProjectIds(projects, project.id)
  const own = features.filter((f) => scope.has(f.projectId))
  const ownSessions = sessions.filter((x) => scope.has(x.projectId))
  const shown = worktree ? 'sessions' : board
  return (
    <div className={s.page}>
      {shown === 'features'
        ? <Board stages={stages} features={unionFeatures(own, repoGroups(projects))} sessions={ownSessions} projects={projects} onOpen={onOpenFeature} />
        : <SessionsBoard sessions={ownSessions} features={own} projects={projects}
          onFocus={onFocusSession} onOpenFeature={onOpenFeature} />}
    </div>
  )
}
