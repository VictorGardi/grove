import { useMemo } from 'react'
import type { ArtifactRef, CanvasView, Feature, Project, Session, UiState } from '@shared/types'
import { filterClusters, neighbours, openCard, pageClusters } from '../artifactsBoard'
import { unionFeatures } from '../featureUnion'
import { repoGroups, repoProjectIds } from '../repoGroups'
import { ArtifactPage } from './ArtifactPage'
import { ArtifactsBoard } from './ArtifactsBoard'
import { Board } from './Board'
import { SessionsBoard } from './SessionsBoard'
import s from './ProjectPage.module.css'

// The content area for one project: its features, sessions or artifacts board (ADR 0018). A checkout's
// page is the repo's — every checkout's sessions, and one card per feature however many checkouts hold
// a copy of it (design D3). The artifacts board clusters those features' files; an open one replaces
// the board full page. A worktree's page is that checkout's sessions and nothing else: the features
// and artifacts boards are repo-scoped, so they live on the parent checkout's page, and ⌘B goes there.
export function ProjectPage({ project, projects, board, stages, features, sessions, artifactsOpen, artifactsView, artifactsFilter, onOpenFeature, onFocusSession, onOpenArtifact, onArtifactsViewChange, onArtifactsFilterChange }: {
  project: Project
  projects: Project[]
  board: UiState['board']
  stages: { id: string; label: string }[]
  features: Feature[] // all features; scoped to the repo here
  sessions: Session[] // all sessions; scoped to the repo here
  artifactsOpen: ArtifactRef | null // the artifact shown full page on the artifacts board
  artifactsView: CanvasView | undefined // the artifacts board's saved pan and zoom
  artifactsFilter: string | null // the slug of the one feature the artifacts board shows; null: all
  onOpenFeature(f: Feature): void
  onFocusSession(id: string): void
  onOpenArtifact(ref: ArtifactRef | null): void
  onArtifactsViewChange(view: CanvasView): void
  onArtifactsFilterChange(slug: string | null, view: CanvasView): void
}) {
  const worktree = !!project.worktreeOf
  const scope = worktree ? new Set([project.id]) : repoProjectIds(projects, project.id)
  const own = features.filter((f) => scope.has(f.projectId))
  const ownSessions = sessions.filter((x) => scope.has(x.projectId))
  const shown = worktree ? 'sessions' : board
  const union = () => unionFeatures(own, repoGroups(projects))
  // stable across unrelated re-renders, so the board's memoised cards and its observer survive them
  const clusters = useMemo(() => shown === 'artifacts' ? pageClusters(project, projects, stages, features) : [],
    [shown, project, projects, stages, features])
  const artifacts = () => {
    // the same decision App's header crumbs make, so the page and its crumbs never disagree
    const open = openCard({ board, artifacts: { [project.id]: { open: artifactsOpen } } }, project, projects, stages, features)
    if (open) {
      // previous and next walk the cards the board draws, so they stay inside its filter
      const ref = { projectId: open.cluster.feature.projectId, slug: open.cluster.feature.slug, name: open.card.name }
      const near = neighbours(filterClusters(clusters, artifactsFilter), ref)
      const feature = { projectId: open.cluster.feature.projectId, slug: open.cluster.feature.slug }
      return <ArtifactPage projectId={feature.projectId} feature={feature} cards={open.cluster.cards} card={open.card} {...near}
        onBack={() => onOpenArtifact(null)} onStep={onOpenArtifact} />
    }
    return (
      // keyed: another page's board starts from that page's saved view, and this one's is saved on the way out
      <ArtifactsBoard key={project.id} clusters={clusters} stages={stages}
        view={artifactsView} onViewChange={onArtifactsViewChange}
        filter={artifactsFilter} onFilterChange={onArtifactsFilterChange}
        onOpen={(c, card) => onOpenArtifact({ projectId: c.feature.projectId, slug: c.feature.slug, name: card.name })} />
    )
  }
  return (
    <div className={s.page}>
      {shown === 'features'
        ? <Board stages={stages} features={union()} sessions={ownSessions} projects={projects} onOpen={onOpenFeature} />
        : shown === 'artifacts' ? artifacts()
        : <SessionsBoard sessions={ownSessions} features={own} projects={projects}
          onFocus={onFocusSession} onOpenFeature={onOpenFeature} />}
    </div>
  )
}
