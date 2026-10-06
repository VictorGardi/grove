import { create } from 'zustand'
import type { FeaturesSlice, OpenCodeSlice, Project, Session, UiState, ViewerTarget } from '@shared/types'
import { DEFAULT_UI, EMPTY_FEATURES, OPENCODE_CONNECTING } from '@shared/types'
import { trackStatus, trackWaiting, type StatusSince } from '../sessionStatus'

interface SlicesState {
  projects: Project[]
  sessions: Session[]
  ui: UiState
  features: FeaturesSlice
  opencode: OpenCodeSlice
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
  openArtifact(t: ViewerTarget): void
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
      const [slices, errors] = await Promise.all([api.invoke('state:get'), api.invoke('app:errors')])
      if (slices.ok) {
        set(slices.data)
        setSessions(slices.data.sessions)
      }
      if (errors.ok) set({ errors: errors.data })
    },
    setFocused: (id) => { void window.api.invoke('ui:set', { focusedSessionId: id }) },
    focusFeature: (ref) => { void window.api.invoke('ui:set', { focusedFeature: ref }) },
    openProject: (id) => { void window.api.invoke('ui:set', { focusedProject: id }) },
    go: (to) => { void window.api.invoke('ui:set', to) },
    setBoard: (board) => { void window.api.invoke('ui:set', { board }) },
    setSidebarTab: (tab) => { void window.api.invoke('ui:set', { sidebarTab: tab }) },
    openArtifact: (t) => { void window.api.invoke('ui:set', { viewer: t }) },
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
