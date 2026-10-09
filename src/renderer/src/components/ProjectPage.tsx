import type { Feature, Project, Session, UiState } from '@shared/types'
import { Board } from './Board'
import { SessionsBoard } from './SessionsBoard'
import s from './ProjectPage.module.css'

// The content area for one project: its features or sessions board (ADR 0018).
export function ProjectPage({ project, projects, board, stages, features, sessions, onOpenFeature, onFocusSession }: {
  project: Project
  projects: Project[]
  board: UiState['board']
  stages: { id: string; label: string }[]
  features: Feature[] // all features; filtered to the project here
  sessions: Session[] // all sessions; filtered to the project here
  onOpenFeature(f: Feature): void
  onFocusSession(id: string): void
}) {
  const own = features.filter((f) => f.projectId === project.id)
  const ownSessions = sessions.filter((x) => x.projectId === project.id)
  return (
    <div className={s.page}>
      {board === 'features'
        ? <Board stages={stages} features={own} sessions={ownSessions} projects={projects} onOpen={onOpenFeature} />
        : <SessionsBoard sessions={ownSessions} features={own} projects={projects}
          onFocus={onFocusSession} onOpenFeature={onOpenFeature} />}
    </div>
  )
}
