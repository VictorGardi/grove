import { create } from 'zustand'
import type { Comment, DiffFile, DocTarget, FeaturesSlice, OpenCodeSlice, Project, Session, SessionDiff, UiState } from '@shared/types'
import { DEFAULT_UI, EMPTY_FEATURES, OPENCODE_CONNECTING } from '@shared/types'
import { openBoard } from '../navigation'
import { trackStatus, trackWaiting, type StatusSince } from '../sessionStatus'

interface SlicesState {
  projects: Project[]
  sessions: Session[]
  ui: UiState
  features: FeaturesSlice
  opencode: OpenCodeSlice
  diff: SessionDiff | null
  comments: Comment[]
  errors: string[]
  waitingSince: Record<string, number> // session id → when first seen waiting (ms)
  statusSince: Record<string, StatusSince> // session id → its shown status and since when (ms)
  hydrate(): Promise<void>
  setFocused(id: string | null): void
  toggleCollapsed(key: string): void
  focusFeature(ref: { projectId: string; slug: string }): void
  openProject(id: string): void
  go(to: Partial<UiState>): void // a breadcrumb up-link
  setBoard(board: UiState['board']): void
  setSidebarTab(tab: UiState['sidebarTab']): void
  openArtifact(t: DocTarget): void
  openDiff(sessionId: string): void
  openRendered(projectId: string, sessionId: string, r: NonNullable<DiffFile['rendered']>): void // "← Diff" returns to sessionId
  closeViewer(): void
  setViewerWidth(px: number): void
  toggleViewerExpanded(): void
  reloadViewer(): void
}

export const useSlices = create<SlicesState>((set, get) => {
  const setSessions = (sessions: Session[]) =>
    set({
      sessions,
      waitingSince: trackWaiting(get().waitingSince, sessions, Date.now()),
      statusSince: trackStatus(get().statusSince, sessions, Date.now()),
    })

  return {
    projects: [],
    sessions: [],
    ui: DEFAULT_UI,
    features: EMPTY_FEATURES,
    opencode: OPENCODE_CONNECTING,
    diff: null,
    comments: [],
    errors: [],
    waitingSince: {},
    statusSince: {},
    async hydrate() {
      const { api } = window
      // subscribe first so a push between the two can't be lost
      api.on('state:projects', (projects) => set({ projects }))
      api.on('state:sessions', setSessions)
      api.on('state:ui', (ui) => set({ ui }))
      api.on('state:features', (features) => set({ features }))
      api.on('state:opencode', (opencode) => set({ opencode }))
      api.on('state:diff', (diff) => set({ diff }))
      api.on('state:comments', (comments) => set({ comments }))
      const [slices, errors] = await Promise.all([api.invoke('state:get'), api.invoke('app:errors')])
      if (slices.ok) {
        set(slices.data)
        setSessions(slices.data.sessions)
      }
      if (errors.ok) set({ errors: errors.data })
    },
    setFocused: (id) => { void window.api.invoke('ui:set', { focusedSessionId: id }) },
    focusFeature: (ref) => { void window.api.invoke('ui:set', { focusedFeature: ref }) },
    openProject: (id) => { void window.api.invoke('ui:set', openBoard(id)) },
    go: (to) => { void window.api.invoke('ui:set', to) },
    setBoard: (board) => { void window.api.invoke('ui:set', { board }) },
    setSidebarTab: (tab) => { void window.api.invoke('ui:set', { sidebarTab: tab }) },
    openArtifact: (t) => { void window.api.invoke('ui:set', { viewer: t }) },
    openDiff: (sessionId) => { void window.api.invoke('ui:set', { viewer: { kind: 'diff', sessionId } }) },
    openRendered: (projectId, sessionId, r) => {
      const viewer = r.slug === null
        ? { kind: 'file' as const, projectId, path: r.path, hash: null, fromDiff: sessionId }
        : { kind: 'artifact' as const, projectId, slug: r.slug, path: r.path, hash: null, fromDiff: sessionId }
      void window.api.invoke('ui:set', { viewer })
    },
    closeViewer: () => { void window.api.invoke('ui:set', { viewer: null }) },
    setViewerWidth: (px) => { void window.api.invoke('ui:set', { viewerWidth: Math.round(px) }) },
    toggleViewerExpanded: () => { void window.api.invoke('ui:set', { viewerExpanded: !get().ui.viewerExpanded }) },
    reloadViewer: () => { void window.api.invoke('viewer:reload') },
    toggleCollapsed(key) {
      const { collapsed } = get().ui
      const next = collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key]
      void window.api.invoke('ui:set', { collapsed: next })
    },
  }
})
