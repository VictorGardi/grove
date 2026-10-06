import type { Feature, Project } from '@shared/types'
import { Board } from './Board'
import s from './ProjectPage.module.css'

// The content area for one project: its board (ADR 0018).
export function ProjectPage({ project, projects, stages, features, onOpenFeature }: {
  project: Project
  projects: Project[]
  stages: { id: string; label: string }[]
  features: Feature[] // all features; filtered to the project here
  onOpenFeature(f: Feature): void
}) {
  const own = features.filter((f) => f.projectId === project.id)
  return (
    <div className={s.page}>
      <Board stages={stages} features={own} projects={projects} onOpen={onOpenFeature} />
    </div>
  )
}
