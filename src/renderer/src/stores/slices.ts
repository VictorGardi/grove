import { create } from 'zustand'
import type { ArtifactRef, CanvasView, Comment, DiffFile, DiffMode, DocTarget, FeaturesSlice, OpenCodeSlice, PaneSpan, Project, Session, SessionDiff, UiState } from '@shared/types'
import { DEFAULT_UI, EMPTY_FEATURES, OPENCODE_CONNECTING } from '@shared/types'
import { focusAfterRemove, gridShown, swapMembers, withMember, withoutArrangement, withSpan, withTracks, type GridLayout } from '../gridView'
import { pushRecentBase } from '../diffBases'
import { diffTargetFor, pickDiffPrefs } from '../diffView'
import { artifactsTo, boardViewTo } from '../artifactsBoard'
import { openBoard } from '../navigation'
import { trackWaiting } from '../sessionStatus'

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
  hydrate(): Promise<void>
  setFocused(id: string | null): void
  toggleCollapsed(key: string): void
  toggleCompact(id: string): void // a session card between its full and one-line form
  toggleHideDone(): void
  toggleProjectVisibility(id: string): void
  focusFeature(ref: { projectId: string; slug: string }): void
  openProject(id: string): void
  go(to: Partial<UiState>): void // a breadcrumb up-link
  setBoard(board: UiState['board']): void
  openBoardArtifact(projectId: string, ref: ArtifactRef | null): void // the artifacts board's full page on that project page; null closes it
  setBoardView(projectId: string, view: CanvasView): void // the artifacts board's pan and zoom on that project page
  setSidebarTab(tab: UiState['sidebarTab']): void
  setGroupBy(groupBy: UiState['groupBy']): void
  setSessionSort(sessionSort: UiState['sessionSort']): void
  setSessionOrder(order: UiState['sessionOrder']): void // shown at once, saved behind it: a drop must not wait for the main process
  toggleSidebar(): void
  openArtifact(t: DocTarget): void
  openDiff(sessionId: string): void
  backToDiff(sessionId: string): void
  setDiffBase(sessionId: string, base: string | null, mode?: DiffMode): void // what the open diff compares against; null: the auto-detected main branch (mode 'branch')
  setDiffMode(sessionId: string, mode: DiffMode): void // the view of the open diff; an explicit base is kept and ignored outside 'branch'
  openRendered(projectId: string, sessionId: string, r: NonNullable<DiffFile['rendered']>): void // "← Diff" returns to sessionId
  closeViewer(): void
  setViewerWidth(px: number): void
  toggleViewerExpanded(): void
  reloadViewer(): void
  toggleGrid(): void // show or hide the session grid; no-op with no members
  toggleGridMember(id: string): void
  addFocusedToGrid(): void // ⇧⌘G: put the focused session in the grid and show it; in a showing grid, pull the focused pane out to full screen
  openAlone(id: string): void // focus a session and turn the grid off
  clearGrid(): void
  swapGridPanes(a: string, b: string): void // dragging a pane header onto another pane
  resetGridArrangement(): void // forget every manual span and track size
  setGridSpan(id: string, span: PaneSpan): void
  setGridTracks(shape: GridLayout, axis: 'cols' | 'rows', fractions: number[] | null): void // null: back to equal
}

export const useSlices = create<SlicesState>((set, get) => {
  const setSessions = (sessions: Session[]) =>
    set({
      sessions,
      waitingSince: trackWaiting(get().waitingSince, sessions, Date.now()),
    })

  // shown at once, saved behind it (like setSessionOrder)
  const setUi = (partial: Partial<UiState>) => {
    set({ ui: { ...get().ui, ...partial } })
    void window.api.invoke('ui:set', partial)
  }

  // the one writer of a diff's view and branch: the open viewer carries them for core, diffPrefs keeps them for the session's next open
  const pickDiff = (sessionId: string, pick: { mode?: DiffMode; base?: string | null }) => {
    const { viewer, diffPrefs, recentBases } = get().ui
    const shown = viewer?.kind === 'diff' && viewer.sessionId === sessionId ? viewer : diffTargetFor(sessionId, diffPrefs)
    const prefs = pickDiffPrefs(shown, pick)
    // a branch picked other than the default (null) is a recent one of the session's project
    const projectId = pick.base ? get().sessions.find((x) => x.id === sessionId)?.projectId : undefined
    const recent = projectId && pick.base ? { recentBases: { ...recentBases, [projectId]: pushRecentBase(recentBases?.[projectId], pick.base) } } : {}
    void window.api.invoke('ui:set', { viewer: { kind: 'diff', sessionId, ...prefs }, diffPrefs: { ...diffPrefs, [sessionId]: prefs }, ...recent })
  }

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
    // Both write the whole artifacts record from the local ui (core merges top-level keys only), so
    // each lands locally at once: a view write right before or after an open then builds on it.
    openBoardArtifact: (projectId, ref) => { setUi(artifactsTo(get().ui, projectId, ref)) },
    setBoardView: (projectId, view) => { setUi(boardViewTo(get().ui, projectId, view)) },
    toggleSidebar: () => { void window.api.invoke('ui:set', { sidebarCollapsed: !get().ui.sidebarCollapsed }) },
    setSidebarTab: (tab) => { void window.api.invoke('ui:set', { sidebarTab: tab }) },
    setGroupBy: (groupBy) => { void window.api.invoke('ui:set', { groupBy }) },
    setSessionSort: (sessionSort) => { void window.api.invoke('ui:set', { sessionSort }) },
    setSessionOrder: (sessionOrder) => {
      set({ ui: { ...get().ui, sessionOrder } })
      void window.api.invoke('ui:set', { sessionOrder })
    },
    openArtifact: (t) => { void window.api.invoke('ui:set', { viewer: t }) },
    openDiff: (sessionId) => { void window.api.invoke('ui:set', { viewer: diffTargetFor(sessionId, get().ui.diffPrefs), viewerExpanded: false }) },
    backToDiff: (sessionId) => { void window.api.invoke('ui:set', { viewer: diffTargetFor(sessionId, get().ui.diffPrefs) }) },
    setDiffBase: (sessionId, base, mode) => pickDiff(sessionId, mode ? { base, mode } : { base }),
    setDiffMode: (sessionId, mode) => pickDiff(sessionId, { mode }),
    openRendered: (projectId, sessionId, r) => {
      const viewer = { kind: 'file' as const, projectId, path: r.path, hash: null, fromDiff: sessionId }
      void window.api.invoke('ui:set', { viewer })
    },
    closeViewer: () => { void window.api.invoke('ui:set', { viewer: null }) },
    setViewerWidth: (px) => { void window.api.invoke('ui:set', { viewerWidth: Math.round(px) }) },
    toggleViewerExpanded: () => { void window.api.invoke('ui:set', { viewerExpanded: !get().ui.viewerExpanded }) },
    reloadViewer: () => { void window.api.invoke('viewer:reload') },
    toggleGrid() {
      const { ui } = get()
      if (gridShown(ui)) return void window.api.invoke('ui:set', { grid: { ...ui.grid, open: false } })
      const { members } = ui.grid
      if (members.length === 0) return
      const focus = ui.focusedSessionId && members.includes(ui.focusedSessionId) ? ui.focusedSessionId : members[0]
      void window.api.invoke('ui:set', { grid: { ...ui.grid, open: true }, focusedSessionId: focus })
    },
    toggleGridMember(id) {
      const { ui } = get()
      // removing the focused pane of a showing grid hands focus to a neighbour, so the grid stays and reflows
      const next = ui.focusedSessionId === id && gridShown(ui) ? focusAfterRemove(ui.grid.members, id) : null
      void window.api.invoke('ui:set', next
        ? { grid: withMember(ui.grid, id), focusedSessionId: next }
        : { grid: withMember(ui.grid, id) })
    },
    addFocusedToGrid() {
      const { ui } = get()
      const id = ui.focusedSessionId
      if (!id) return
      // the pane leaves the grid and stays focused, so it shows alone; ⇧⌘G again puts it back
      if (gridShown(ui)) return void window.api.invoke('ui:set', { grid: withMember(ui.grid, id) })
      const grid = ui.grid.members.includes(id) ? ui.grid : withMember(ui.grid, id)
      if (!grid.members.includes(id)) return // the grid holds its nine
      void window.api.invoke('ui:set', { grid: { ...grid, open: true } })
    },
    openAlone: (id) => { void window.api.invoke('ui:set', { focusedSessionId: id, grid: { ...get().ui.grid, open: false } }) },
    clearGrid: () => { void window.api.invoke('ui:set', { grid: { open: false, members: [] } }) },
    swapGridPanes: (a, b) => { void window.api.invoke('ui:set', { grid: swapMembers(get().ui.grid, a, b) }) },
    resetGridArrangement: () => { void window.api.invoke('ui:set', { grid: withoutArrangement(get().ui.grid) }) },
    setGridSpan: (id, span) => { void window.api.invoke('ui:set', { grid: withSpan(get().ui.grid, id, span) }) },
    setGridTracks: (shape, axis, fractions) => { void window.api.invoke('ui:set', { grid: withTracks(get().ui.grid, shape, axis, fractions) }) },
    toggleCollapsed(key) {
      const { collapsed } = get().ui
      const next = collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key]
      void window.api.invoke('ui:set', { collapsed: next })
    },
    toggleCompact(id) {
      const compact = get().ui.compact ?? []
      const next = compact.includes(id) ? compact.filter((x) => x !== id) : [...compact, id]
      void window.api.invoke('ui:set', { compact: next })
    },
    toggleHideDone() { void window.api.invoke('ui:set', { hideDone: !get().ui.hideDone }) },
    toggleProjectVisibility(id) {
      const hidden = get().ui.hiddenProjects ?? []
      const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id]
      void window.api.invoke('ui:set', { hiddenProjects: next })
    },
  }
})
