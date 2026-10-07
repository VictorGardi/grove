import { useCallback, useEffect, useState } from 'react'
import type { Feature, Session, ViewerTarget } from '@shared/types'
import { SIDEBAR_WIDTH } from '@shared/types'
import { ArtifactViewer } from './components/ArtifactViewer'
import { ConfirmDialog } from './components/ConfirmDialog'
import { DiffViewer } from './components/DiffViewer'
import { FeaturePage } from './components/FeaturePage'
import { NewSessionModal } from './components/NewSessionModal'
import { ProjectPage } from './components/ProjectPage'
import { Sidebar } from './components/Sidebar'
import { TerminalView } from './components/TerminalView'
import { AppShell } from './components/shell/AppShell'
import { BoardSwitch } from './components/shell/BoardSwitch'
import { ContentHeader } from './components/shell/ContentHeader'
import { TopBar } from './components/shell/TopBar'
import { Banner } from './components/ui/Banner'
import { Button } from './components/ui/Button'
import { boardKey, childrenOf, content, crumbs, currentProjectId } from './navigation'
import { longestWaiting, serviceBanners, shownStatus } from './sessionStatus'
import { useSlices } from './stores/slices'
import { sessionGroups, sessionOrder } from './tree'
import { viewableFiles } from './viewerFiles'
import s from './App.module.css'

export default function App() {
  const { projects, sessions, ui, features, opencode, diff, errors, waitingSince, statusSince, hydrate, setFocused, focusFeature, go, setBoard,
    openArtifact, openDiff, openRendered, closeViewer, setViewerWidth, toggleViewerExpanded, reloadViewer } = useSlices()
  const [newFor, setNewFor] = useState<{ projectId?: string } | null>(null)
  const [confirmKill, setConfirmKill] = useState<Session | null>(null)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // the Diff button and ⌥⌘B: open this session's diff, or close it when it's the one shown
  const toggleDiff = useCallback((id: string, viewer: ViewerTarget | null) => {
    if (viewer?.kind === 'diff' && viewer.sessionId === id) closeViewer()
    else openDiff(id)
  }, [openDiff, closeViewer])

  useEffect(() => {
    return window.api.on('menu:action', (a) => {
      // read the latest state, not this effect's closure
      const { projects, sessions, ui, features } = useSlices.getState()
      if (a.type === 'newSession') setNewFor({ projectId: currentProjectId(content(ui, projects, sessions, features.items)) ?? undefined })
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
        if (focused?.lastStatus === 'running') setConfirmKill(focused)
      } else if (a.type === 'focusIndex') {
        const target = sessionOrder(sessionGroups(projects, sessions, ui))[a.n - 1]
        if (target) setFocused(target.id)
      } else if (a.type === 'projectBoard') {
        const to = boardKey(ui, projects, sessions, features.items)
        if (to) go(to)
      } else if (a.type === 'sessionDiff') {
        if (ui.focusedSessionId) toggleDiff(ui.focusedSessionId, ui.viewer)
      }
    })
  }, [setFocused, go, toggleDiff])

  const openNew = (projectId?: string) => setNewFor({ projectId })
  const shown = content(ui, projects, sessions, features.items)
  const header = crumbs(shown, projects, features.items).map((c) => ({ label: c.label, onClick: c.to && (() => go(c.to!)) }))
  const openFeature = (f: Feature) => focusFeature({ projectId: f.projectId, slug: f.slug })
  const v = ui.viewer
  const viewerFeature = v?.kind === 'artifact' ? features.items.find((f) => f.projectId === v.projectId && f.slug === v.slug) : undefined
  const diffOpen = (id: string) => v?.kind === 'diff' && v.sessionId === id
  const waitingCount = sessions.filter((x) => shownStatus(x) === 'waiting').length
  const focusWaiting = () => {
    const w = longestWaiting(sessions, waitingSince)
    if (w) setFocused(w.id)
  }

  return (
    <>
      <AppShell
        topBar={<TopBar onNew={() => openNew()} waiting={waitingCount} onWaiting={focusWaiting} />}
        banners={[
          ...errors.map((e, i) => <Banner key={i}>{e}</Banner>),
          ...(features.workflowError ? [<Banner key="workflow">Workflow: {features.workflowError}</Banner>] : []),
          ...serviceBanners(opencode, sessions).map((b) => <Banner key={b.text} tone={b.tone}>{b.text}</Banner>),
        ]}
        sidebar={<Sidebar onNew={openNew} onKill={setConfirmKill} />}
        content={
          <>
            <ContentHeader crumbs={header}
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
                onOpenArtifact={(name) => openArtifact({ kind: 'artifact', projectId: shown.feature.projectId, slug: shown.feature.slug, path: name, hash: null, fromDiff: null })} />
            ) : shown.kind === 'session' && shown.session.lastStatus === 'running' ? (
              <TerminalView key={shown.session.id} sessionId={shown.session.id} />
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
          <ArtifactViewer target={v} groups={viewerFeature ? viewableFiles(viewerFeature, features.stages) : []}
            mtimeMs={viewerFeature ? viewerFeature.artifacts.find((a) => a.name === v.path)?.mtimeMs : undefined}
            expanded={ui.viewerExpanded} onToggleExpanded={toggleViewerExpanded} onReload={reloadViewer}
            onOpen={(path) => openArtifact({ ...v, path, hash: null })}
            onBack={v.fromDiff ? () => openDiff(v.fromDiff!) : undefined} onClose={closeViewer} />
        ) : undefined}
        sidebarWidth={SIDEBAR_WIDTH}
        viewerWidth={ui.viewerWidth}
        viewerExpanded={ui.viewerExpanded}
        onViewerWidth={setViewerWidth}
      />
      {newFor && <NewSessionModal initialProjectId={newFor.projectId} onClose={() => setNewFor(null)} />}
      {confirmKill && (
        <ConfirmDialog
          title="Close session"
          body={`Kill session ${confirmKill.label}?`}
          confirmLabel="Kill"
          onConfirm={() => {
            void window.api.invoke('session:kill', { id: confirmKill.id })
            setConfirmKill(null)
          }}
          onCancel={() => setConfirmKill(null)}
        />
      )}
    </>
  )
}
