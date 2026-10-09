import { useCallback, useEffect, useRef, useState } from 'react'
import type { Feature, Session, SessionKind, ViewerTarget } from '@shared/types'
import type { MenuAction } from '@shared/ipc'
import { SIDEBAR_RAIL_WIDTH, SIDEBAR_WIDTH } from '@shared/types'
import { ArtifactViewer } from './components/ArtifactViewer'
import { CommandPalette } from './components/CommandPalette'
import { DiffViewer } from './components/DiffViewer'
import { FeaturePage } from './components/FeaturePage'
import { ProjectPage } from './components/ProjectPage'
import { SessionGrid } from './components/SessionGrid'
import { Sidebar } from './components/Sidebar'
import { SidebarRail } from './components/SidebarRail'
import { TerminalView } from './components/TerminalView'
import { AppShell } from './components/shell/AppShell'
import { BoardSwitch } from './components/shell/BoardSwitch'
import { ContextPopover } from './components/ContextGauge'
import { ContentHeader } from './components/shell/ContentHeader'
import { Banner } from './components/ui/Banner'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Button } from './components/ui/Button'
import { newSessionItems, paletteItems } from './paletteItems'
import { DEFAULT_GRID_VIEW, gridShown, visibleMembers, type GridView } from './gridView'
import { contextView } from './contextGauge'
import { boardKey, childrenOf, content, crumbs, currentProjectId, focusTarget } from './navigation'
import { serviceBanners } from './sessionStatus'
import { sessionDiffShortcut, type HiddenRenderedViewer } from './sessionDiffShortcut'
import { useSlices } from './stores/slices'
import { featureDir, featureOfFile, viewableFiles } from './viewerFiles'
import { ScratchpadOverlay } from './components/ScratchpadOverlay'
import s from './App.module.css'

export default function App() {
  const { projects, sessions, ui, features, opencode, diff, errors, statusSince, hydrate, setFocused, focusFeature, openProject, toggleGrid, addFocusedToGrid, toggleSidebar, clearGrid, go, setBoard,
    openArtifact, openDiff, backToDiff, openRendered, closeViewer, setViewerWidth, toggleViewerExpanded, reloadViewer } = useSlices()
  const [quickNew, setQuickNew] = useState<{ projectId?: string } | null>(null) // ⌘T: the new-session palette
  const [confirmRemove, setConfirmRemove] = useState<Session | null>(null) // ⌘W asks first
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [gridView, setGridView] = useState<GridView>(DEFAULT_GRID_VIEW) // toolbar settings, view-only
  const [scratchpadOpen, setScratchpadOpen] = useState(false) // ⌘N: global notes, not persisted
  const hiddenRendered = useRef<HiddenRenderedViewer | null>(null)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // The Diff button opens this session's diff, or closes it when it's the one shown.
  const toggleDiff = useCallback((id: string, viewer: ViewerTarget | null) => {
    if (viewer?.kind === 'diff' && viewer.sessionId === id) closeViewer()
    else openDiff(id)
  }, [openDiff, closeViewer])

  const toggleSessionDiff = useCallback((id: string, viewer: ViewerTarget | null) => {
    const action = sessionDiffShortcut(viewer, hiddenRendered.current)
    if (action.kind === 'hide-rendered') {
      hiddenRendered.current = action.hidden
      closeViewer()
    } else if (action.kind === 'restore-rendered') {
      hiddenRendered.current = null
      openArtifact(action.target)
    } else {
      hiddenRendered.current = null
      toggleDiff(id, viewer)
    }
  }, [closeViewer, openArtifact, toggleDiff])

  // the menu and the palette both run actions through here
  const runAction = useCallback((a: MenuAction) => {
    // read the latest state, not this callback's closure
    const { projects, sessions, ui, features } = useSlices.getState()
    if (a.type === 'palette') setPaletteOpen(true)
    else if (a.type === 'toggleGrid') toggleGrid()
    else if (a.type === 'addToGrid') addFocusedToGrid()
    else if (a.type === 'toggleSidebar') toggleSidebar()
    else if (a.type === 'clearGrid') clearGrid()
    else if (a.type === 'newSession') setQuickNew({ projectId: currentProjectId(content(ui, projects, sessions, features.items)) ?? undefined })
    else if (a.type === 'newTerminal') {
      const projectId = currentProjectId(content(ui, projects, sessions, features.items))
      if (projectId) {
        void window.api.invoke('session:create', { projectId, kind: 'terminal', cols: 120, rows: 40 }).then((res) => {
          if (res.ok) setFocused(res.data.id)
        })
      }
    }
    else if (a.type === 'closeSession') {
      const focused = sessions.find((x) => x.id === ui.focusedSessionId)
      if (focused) setConfirmRemove(focused)
    } else if (a.type === 'lastSession') {
      void window.api.invoke('session:focusLast')
    } else if (a.type === 'focusIndex') {
      const target = focusTarget(ui, projects, sessions, features.items, a.n, gridView)
      if (target) setFocused(target.id)
    } else if (a.type === 'projectBoard') {
      const to = boardKey(ui, projects, sessions, features.items)
      if (to) go(to)
    } else if (a.type === 'sessionDiff') {
      if (ui.focusedSessionId) toggleSessionDiff(ui.focusedSessionId, ui.viewer)
    } else if (a.type === 'scratchpad') {
      setScratchpadOpen((o) => !o)
    }
  }, [setFocused, go, toggleSessionDiff, toggleGrid, addFocusedToGrid, toggleSidebar, clearGrid, gridView])

  useEffect(() => {
    const hidden = hiddenRendered.current
    if (!hidden) return
    if (ui.viewer && (
      ui.viewer.kind !== 'file' || ui.viewer.fromDiff !== hidden.sessionId ||
      ui.viewer.projectId !== hidden.target.projectId || ui.viewer.path !== hidden.target.path
    )) hiddenRendered.current = null
  }, [ui.viewer])

  useEffect(() => window.api.on('menu:action', runAction), [runAction])

  const createSession = (projectId: string, kind: SessionKind) => {
    void window.api.invoke('session:create', { projectId, kind, cols: 120, rows: 40 }).then((res) => {
      if (res.ok) setFocused(res.data.id)
    })
  }
  const shown = content(ui, projects, sessions, features.items)
  // a filter or the eye can hide the focused pane: focus the first one still visible
  const changeGridView = (next: GridView) => {
    setGridView(next)
    if (shown.kind !== 'grid') return
    const visible = visibleMembers(shown.sessions, next)
    if (visible.length > 0 && !visible.some((x) => x.id === shown.focused.id)) setFocused(visible[0].id)
  }
  const header = crumbs(shown, projects, features.items).map((c) => ({ label: c.label, onClick: c.to && (() => go(c.to!)) }))
  const context = shown.kind === 'session' ? contextView(shown.session) : null
  const openFeature = (f: Feature) => focusFeature({ projectId: f.projectId, slug: f.slug })
  const v = ui.viewer
  const viewerHit = v?.kind === 'file' ? featureOfFile(v, features.items, projects) : undefined
  const viewerFeature = viewerHit?.feature
  const viewerDir = viewerHit?.dir ?? ''
  const diffOpen = (id: string) => v?.kind === 'diff' && v.sessionId === id

  return (
    <>
      <AppShell
        banners={[
          ...errors.map((e, i) => <Banner key={i}>{e}</Banner>),
          ...(features.workflowError ? [<Banner key="workflow">Workflow: {features.workflowError}</Banner>] : []),
          ...serviceBanners(opencode, sessions).map((b) => <Banner key={b.text} tone={b.tone}>{b.text}</Banner>),
        ]}
        sidebar={ui.sidebarCollapsed ? <SidebarRail /> : <Sidebar onNew={(projectId) => setQuickNew({ projectId })} />}
        content={
          <>
            <ContentHeader crumbs={header}
              after={context ? <ContextPopover view={context} /> : undefined}
              right={shown.kind === 'project' ? <BoardSwitch board={ui.board} onChange={setBoard} />
                : shown.kind === 'session' ? (
                  <div className={s.headerActions}>
                    <Button variant="ghost" size="sm" aria-pressed={diffOpen(shown.session.id)}
                      onClick={() => toggleDiff(shown.session.id, v)}>Diff</Button>
                  </div>
                ) : undefined} />
            {shown.kind === 'project' ? (
              <ProjectPage project={shown.project} projects={projects} board={ui.board} stages={features.stages}
                features={features.items} sessions={sessions} statusSince={statusSince}
                onOpenFeature={openFeature} onFocusSession={setFocused} />
            ) : shown.kind === 'feature' ? (
              <FeaturePage feature={shown.feature}
                parent={features.items.find((f) => f.projectId === shown.feature.projectId && f.slug === shown.feature.parent) ?? null}
                children={childrenOf(shown.feature, features.items)} sessions={sessions}
                onFocusSession={setFocused} onOpenFeature={openFeature}
                onOpenArtifact={(name) => {
                  const dir = featureDir(shown.feature, projects)
                  if (dir !== null) openArtifact({ kind: 'file', projectId: shown.feature.projectId, path: dir + name, hash: null, fromDiff: null })
                }} />
            ) : shown.kind === 'grid' ? (
              <SessionGrid sessions={shown.sessions} focusedId={shown.focused.id} view={gridView} onViewChange={changeGridView} onFocusPane={setFocused} overlayOpen={paletteOpen || !!quickNew || !!confirmRemove} />
            ) : shown.kind === 'session' && shown.session.lastStatus === 'running' ? (
              <TerminalView key={shown.session.id} sessionId={shown.session.id} active={!paletteOpen && !quickNew && !confirmRemove} />
            ) : shown.kind === 'session' ? (
              <div className={s.ended}>
                <div className={s.endedTitle}>Session ended</div>
                <div className={s.endedActions}>
                  {shown.session.kind !== 'terminal' && (
                    <Button icon="resume" variant="primary" onClick={() => void window.api.invoke('session:resume', { id: shown.session.id })}>Resume</Button>
                  )}
                  <Button icon="trash" onClick={() => void window.api.invoke('session:remove', { id: shown.session.id })}>Remove</Button>
                </div>
              </div>
            ) : (
              <div className={s.empty}>Add a project with the folder ＋ in the sidebar</div>
            )}
          </>
        }
        viewer={v?.kind === 'diff' ? (
          <DiffViewer diff={diff} sessionId={v.sessionId} label={sessions.find((x) => x.id === v.sessionId)?.label ?? 'session'}
            expanded={ui.viewerExpanded} onOpenRendered={(projectId, r) => openRendered(projectId, v.sessionId, r)}
            onToggleExpanded={toggleViewerExpanded} onClose={closeViewer} />
        ) : v ? (
          <ArtifactViewer target={v} dir={viewerDir} groups={viewerFeature ? viewableFiles(viewerFeature, features.stages) : []}
            mtimeMs={viewerFeature ? viewerFeature.artifacts.find((a) => viewerDir + a.name === v.path)?.mtimeMs : undefined}
            expanded={ui.viewerExpanded} onToggleExpanded={toggleViewerExpanded} onReload={reloadViewer}
            onOpen={(path) => openArtifact({ ...v, path, hash: null })}
            onBack={v.fromDiff ? () => backToDiff(v.fromDiff!) : undefined} onClose={closeViewer} />
        ) : undefined}
        sidebarWidth={ui.sidebarCollapsed ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH}
        viewerWidth={ui.viewerWidth}
        viewerExpanded={ui.viewerExpanded}
        onViewerWidth={setViewerWidth}
      />
      {paletteOpen && (
        <CommandPalette onClose={() => setPaletteOpen(false)}
          items={paletteItems({ projects, sessions, features: features.items, grid: ui.grid, gridShown: gridShown(ui) }, { focusSession: setFocused, focusFeature, openProject, runAction })} />
      )}
      {confirmRemove && (
        <ConfirmDialog
          title="Remove session"
          body={`Remove session ${confirmRemove.label}? It will be ended and can't be resumed.`}
          confirmLabel="Remove"
          onConfirm={() => {
            void window.api.invoke('session:remove', { id: confirmRemove.id })
            setConfirmRemove(null)
          }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
      {quickNew && (
        <CommandPalette onClose={() => setQuickNew(null)} placeholder="New session — pick a kind…"
          items={newSessionItems(projects, quickNew.projectId, createSession)} />
      )}
      {scratchpadOpen && <ScratchpadOverlay onClose={() => setScratchpadOpen(false)} />}
    </>
  )
}
