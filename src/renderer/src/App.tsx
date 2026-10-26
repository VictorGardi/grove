import { useCallback, useEffect, useRef, useState } from 'react'
import type { Feature, Session, ViewerTarget } from '@shared/types'
import type { MenuAction } from '@shared/ipc'
import { errorMessage } from '@shared/sessionErrors'
import { SIDEBAR_RAIL_WIDTH, SIDEBAR_WIDTH } from '@shared/types'
import { ArtifactViewer } from './components/ArtifactViewer'
import { CommandPalette } from './components/CommandPalette'
import { DiffViewer } from './components/DiffViewer'
import { FeaturePage } from './components/FeaturePage'
import { ProjectPage } from './components/ProjectPage'
import { SessionGrid } from './components/SessionGrid'
import { SessionMeta } from './components/SessionMeta'
import { Sidebar } from './components/Sidebar'
import { SidebarRail } from './components/SidebarRail'
import { TerminalView } from './components/TerminalView'
import { AppShell, SIDEBAR_MAX, SIDEBAR_MIN } from './components/shell/AppShell'
import { BoardSwitch } from './components/shell/BoardSwitch'
import { ContextPopover } from './components/ContextGauge'
import { ContentHeader, Crumbs } from './components/shell/ContentHeader'
import { Banner } from './components/ui/Banner'
import { ConfirmDialog } from './components/ConfirmDialog'
import { NewSessionDialog, type Launch } from './components/NewSessionDialog'
import { LaunchPalette } from './components/LaunchPalette'
import { Button } from './components/ui/Button'
import { paletteItems } from './paletteItems'
import { useRepoRefs } from './useRepoRefs'
import { DEFAULT_GRID_VIEW, gridShown, visibleMembers, type GridView } from './gridView'
import { contextView } from './contextGauge'
import { artifactCrumbs, openCard } from './artifactsBoard'
import { boardKey, childrenOf, content, crumbs, currentProjectId, focusTarget } from './navigation'
import { serviceBanners } from './sessionStatus'
import { sessionDiffShortcut, type HiddenRenderedViewer } from './sessionDiffShortcut'
import { useSlices } from './stores/slices'
import { useSessionRemoval } from './useSessionRemoval'
import { colorTags } from './tags'
import { featureDir, featureOfFile, viewableFiles } from './viewerFiles'
import { ScratchpadOverlay } from './components/ScratchpadOverlay'
import { longestWaiting } from './sessionStatus'
import s from './App.module.css'

export default function App() {
  const { projects, sessions, ui, features, opencode, diff, errors, hydrate, setFocused, focusFeature, openProject, toggleGrid, addFocusedToGrid, toggleSidebar, clearGrid, go, setBoard, openBoardArtifact, setBoardView,
    openArtifact, openDiff, backToDiff, openRendered, closeViewer, setViewerWidth, toggleViewerExpanded, reloadViewer } = useSlices()
  const [quickNew, setQuickNew] = useState<{ projectId?: string } | null>(null) // ⌘T: the new-session palette
  const repoRefs = useRepoRefs(projects)
  const [launchNew, setLaunchNew] = useState<{ projectId?: string } | null>(null) // ⌘⇧T: the launch dialog
  const { removeSessions, dialog: removalDialog } = useSessionRemoval()
  const [confirmRemove, setConfirmRemove] = useState<Session | null>(null) // ⌘W asks first
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [gridView, setGridView] = useState<GridView>(DEFAULT_GRID_VIEW) // toolbar settings, view-only
  const [scratchpadOpen, setScratchpadOpen] = useState(false) // ⌘N: global notes, not persisted
  const [noteSession, setNoteSession] = useState<{ id: string; label: string } | null>(null) // a session card's note
  const hiddenRendered = useRef<HiddenRenderedViewer | null>(null)
  const tags = colorTags(projects, features.items)

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
    const { projects, sessions, ui, features, waitingSince } = useSlices.getState()
    if (a.type === 'palette') setPaletteOpen(true)
    else if (a.type === 'toggleGrid') toggleGrid()
    else if (a.type === 'addToGrid') addFocusedToGrid()
    else if (a.type === 'toggleSidebar') toggleSidebar()
    else if (a.type === 'clearGrid') clearGrid()
    else if (a.type === 'newSession') setQuickNew({ projectId: currentProjectId(content(ui, projects, sessions, features.items)) ?? undefined })
    else if (a.type === 'newSessionOptions') setLaunchNew({ projectId: currentProjectId(content(ui, projects, sessions, features.items)) ?? undefined })
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
    } else if (a.type === 'nextWaiting') {
      const w = longestWaiting(sessions, waitingSince)
      if (w) setFocused(w.id)
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

  // The configured launch. A new worktree is made by `session:create` itself, so the card is in
  // the sidebar from the click and a conflict still comes back here, against the form the human is
  // still looking at. Returns the error, or null once it started.
  const startLaunch = useCallback(async (l: Launch): Promise<string | null> => {
    const projectId = l.where.type === 'existing' ? l.where.project.id : l.where.from.id
    const trimmed = l.label.trim()
    const res = await window.api.invoke('session:create', {
      projectId,
      ...(l.where.type === 'new' && { worktree: { branch: l.where.branch, ...(l.where.base && { base: l.where.base }) } }),
      kind: l.kind,
      ...(l.prompt.trim() && { prompt: l.prompt.trim() }),
      ...(trimmed && { label: trimmed }),
      ...(l.feature && { feature: l.feature }),
      cols: 120,
      rows: 40,
    })
    // the same sentence the CLI would print: a refusal the human cannot act on is a refusal that
    // was not worth having
    if (!res.ok) return errorMessage(res.error)
    setFocused(res.data.id)
    setLaunchNew(null)
    setQuickNew(null)
    return null
  }, [setFocused])
  const shown = content(ui, projects, sessions, features.items)
  // a filter or the eye can hide the focused pane: focus the first one still visible
  const changeGridView = (next: GridView) => {
    setGridView(next)
    if (shown.kind !== 'grid') return
    const visible = visibleMembers(shown.sessions, next, projects)
    if (visible.length > 0 && !visible.some((x) => x.id === shown.focused.id)) setFocused(visible[0].id)
  }
  const openArt = shown.kind === 'project' ? openCard(ui, shown.project, projects, features.stages, features.items) : undefined
  const trail = openArt && shown.kind === 'project' ? artifactCrumbs(shown.project, openArt.cluster.feature, openArt.card, ui) : crumbs(shown, projects, features.items)
  const header = trail.map((c) => ({ label: c.label, onClick: c.to && (() => go(c.to!)) }))
  const context = shown.kind === 'session' ? contextView(shown.session) : null
  // the same tag colour a grid pane gives this session's feature: one rule, two places
  const linked = shown.kind === 'session'
    ? features.items.find((f) => f.projectId === shown.session.projectId && f.slug === shown.session.feature) ?? null
    : null
  const linkedIndex = linked ? tags.group(linked.projectId, linked.group ? linked.slug : linked.parent) : null
  const openFeature = (f: Feature) => focusFeature({ projectId: f.projectId, slug: f.slug })
  const v = ui.viewer
  const viewerHit = v?.kind === 'file' ? featureOfFile(v, features.items, projects) : undefined
  const viewerFeature = viewerHit?.feature
  const viewerDir = viewerHit?.dir ?? ''
  const diffOpen = (id: string) => v?.kind === 'diff' && v.sessionId === id
  // Every modal over the content has to take the keyboard from it, or a focused terminal keeps the
  // keys the human is typing into a form. This was two lists — the grid's `overlayOpen` and the
  // terminal's `active` — and they had already drifted, each missing an overlay the other had. One
  // value now, with `active` as its negation, so there is nothing left to keep in step.
  const overlayOpen = paletteOpen || !!quickNew || !!launchNew || !!confirmRemove || scratchpadOpen || !!noteSession

  return (
    <>
      <AppShell
        banners={[
          ...errors.map((e, i) => <Banner key={i}>{e}</Banner>),
          ...(features.workflowError ? [<Banner key="workflow">Workflow: {features.workflowError}</Banner>] : []),
          ...serviceBanners(opencode, sessions).map((b) => <Banner key={b.text} tone={b.tone}>{b.text}</Banner>),
        ]}
        sidebar={ui.sidebarCollapsed ? <SidebarRail onNew={() => setQuickNew({ projectId: currentProjectId(content(ui, projects, sessions, features.items)) ?? undefined })} /> : <Sidebar onNew={(projectId) => setQuickNew({ projectId })} onRemove={(ids) => void removeSessions(ids)} onNote={(s) => setNoteSession({ id: s.id, label: s.label })} />}
        content={
          <>
            <ContentHeader crumbs={header}
              meta={shown.kind === 'session'
                ? <SessionMeta lead={<Crumbs crumbs={header} />} session={shown.session}
                    feature={linked} featureInLead tagIndex={linkedIndex}
                    context={context ? <ContextPopover view={context} /> : undefined} />
                : undefined}
              right={shown.kind === 'project' && !shown.project.worktreeOf ? <BoardSwitch board={ui.board} onChange={setBoard} />
                : shown.kind === 'session' ? (
                  <div className={s.headerActions}>
                    <Button variant="ghost" size="sm" aria-pressed={diffOpen(shown.session.id)}
                      onClick={() => toggleDiff(shown.session.id, v)}>Diff</Button>
                  </div>
                ) : undefined} />
            {shown.kind === 'project' ? (
              <ProjectPage project={shown.project} projects={projects} board={ui.board} stages={features.stages}
                features={features.items} sessions={sessions} artifactsOpen={ui.artifacts?.[shown.project.id]?.open ?? null}
                artifactsView={ui.artifacts?.[shown.project.id]?.view}
                onOpenFeature={openFeature} onFocusSession={setFocused} onOpenArtifact={(r) => openBoardArtifact(shown.project.id, r)}
                onArtifactsViewChange={(v) => setBoardView(shown.project.id, v)} />
            ) : shown.kind === 'feature' ? (
              <FeaturePage feature={shown.feature}
                parent={features.items.find((f) => f.projectId === shown.feature.projectId && f.slug === shown.feature.parent) ?? null}
                children={childrenOf(shown.feature, features.items)} sessions={sessions} projects={projects}
                onFocusSession={setFocused} onOpenFeature={openFeature}
                onOpenArtifact={(name) => {
                  const dir = featureDir(shown.feature, projects)
                  if (dir !== null) openArtifact({ kind: 'file', projectId: shown.feature.projectId, path: dir + name, hash: null, fromDiff: null })
                }} />
            ) : shown.kind === 'grid' ? (
              <SessionGrid sessions={shown.sessions} focusedId={shown.focused.id} view={gridView} onViewChange={changeGridView} onFocusPane={setFocused} overlayOpen={overlayOpen} />
            ) : shown.kind === 'session' && shown.session.lastStatus === 'running' ? (
              <TerminalView key={shown.session.id} sessionId={shown.session.id} active={!overlayOpen} />
            ) : shown.kind === 'session' ? (
              <div className={s.ended}>
                <div className={s.endedTitle}>Session ended</div>
                <div className={s.endedActions}>
                  {shown.session.kind !== 'terminal' && (
                    <Button icon="resume" variant="primary" onClick={() => void window.api.invoke('session:resume', { id: shown.session.id })}>Resume</Button>
                  )}
                  <Button icon="trash" onClick={() => void removeSessions([shown.session.id])}>Remove</Button>
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
        sidebarWidth={ui.sidebarCollapsed ? SIDEBAR_RAIL_WIDTH : Math.min(Math.max(ui.sidebarWidth, SIDEBAR_MIN), SIDEBAR_MAX)}
        onSidebarWidth={ui.sidebarCollapsed ? undefined : (px) => void window.api.invoke('ui:set', { sidebarWidth: px === null ? SIDEBAR_WIDTH : Math.round(px) })}
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
            void removeSessions([confirmRemove.id])
            setConfirmRemove(null)
          }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
      {removalDialog}
      {quickNew && (
        <LaunchPalette projects={projects} sessions={sessions} openedFrom={quickNew.projectId} refs={repoRefs}
          onClose={() => setQuickNew(null)} onStart={startLaunch} />
      )}
      {launchNew && (
        <NewSessionDialog projectId={launchNew.projectId} onClose={() => setLaunchNew(null)} onStart={startLaunch} />
      )}
      {scratchpadOpen && <ScratchpadOverlay onClose={() => setScratchpadOpen(false)} />}
      {noteSession && <ScratchpadOverlay session={noteSession} onClose={() => setNoteSession(null)} />}
    </>
  )
}
