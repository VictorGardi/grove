import type { Project } from '@shared/types'
import { Button } from './ui/Button'
import s from './ProjectPage.module.css'

// The minimal project page: no boards or lists. Sessions are in the sidebar; features and artifacts
// are found by name in cmd+K, or reached from a linked session (design D5).
export function ProjectPage({ project, onNewSession }: {
  project: Project
  onNewSession(projectId: string): void
}) {
  return (
    <div className={s.page}>
      <h1 className={s.name}>{project.name}</h1>
      <Button icon="plus" variant="primary" onClick={() => onNewSession(project.id)}>New session</Button>
      <p className={s.hint}>⌘K to find features, artifacts and sessions</p>
    </div>
  )
}
