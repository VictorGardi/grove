import { useEffect, useState } from 'react'
import type { Session } from '@shared/types'
import { ArtifactViewer } from './components/ArtifactViewer'
import { Board } from './components/Board'
import { ConfirmDialog } from './components/ConfirmDialog'
import { FeaturePage } from './components/FeaturePage'
import { NewSessionModal } from './components/NewSessionModal'
import { Sidebar } from './components/Sidebar'
import { TerminalView } from './components/TerminalView'
import { AppShell } from './components/shell/AppShell'
import { ContentHeader } from './components/shell/ContentHeader'
import { TopBar } from './components/shell/TopBar'
import { ViewToggle } from './components/shell/ViewToggle'
import { Banner } from './components/ui/Banner'
import { Button } from './components/ui/Button'
import { useSlices } from './stores/slices'
import { sessionGroups, sessionOrder } from './tree'
import { viewableFiles } from './viewerFiles'
import s from './App.module.css'

export default function App() {
  const { projects, sessions, ui, features, errors, hydrate, setFocused, setView, openFeature, openArtifact, closeViewer,
    setViewerWidth, toggleViewerExpanded, reloadViewer } = useSlices()
  const [newFor, setNewFor] = useState<{ projectId?: string } | null>(null)
  const [confirmKill, setConfirmKill] = useState<Session | null>(null)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    return window.api.on('menu:action', (a) => {
      // read the latest state, not this effect's closure
      const { projects, sessions, ui } = useSlices.getState()
      if (a.type === 'newSession') setNewFor({})
      else if (a.type === 'closeSession') {
        const focused = sessions.find((x) => x.id === ui.focusedSessionId)
        if (focused?.lastStatus === 'running') setConfirmKill(focused)
      } else if (a.type === 'focusIndex') {
        const target = sessionOrder(sessionGroups(projects, sessions, ui))[a.n - 1]
        if (target) setFocused(target.id)
      }
    })
  }, [setFocused])

  const openNew = (projectId?: string) => setNewFor({ projectId })
  const focused = sessions.find((x) => x.id === ui.focusedSessionId)
  const ff = ui.focusedFeature
  const focusedFeature = ff && features.items.find((f) => f.projectId === ff.projectId && f.slug === ff.slug)
  const projectId = focusedFeature ? focusedFeature.projectId : focused?.projectId
  const project = projects.find((p) => p.id === projectId)
  const title = focusedFeature ? focusedFeature.title : focused?.label
  const board = ui.view === 'board'
  const crumbs = board ? ['Board'] : title ? [...(project ? [project.name] : []), title] : []
  const v = ui.viewer
  const viewerFeature = v && features.items.find((f) => f.projectId === v.projectId && f.slug === v.slug)

  return (
    <>
      <AppShell
        topBar={<TopBar onNew={() => openNew()} />}
        banners={[
          ...errors.map((e, i) => <Banner key={i}>{e}</Banner>),
          ...(features.workflowError ? [<Banner key="workflow">Workflow: {features.workflowError}</Banner>] : []),
        ]}
        sidebar={<Sidebar onNew={openNew} />}
        content={
          <>
            <ContentHeader crumbs={crumbs} right={<ViewToggle view={ui.view} onChange={setView} />} />
            {board ? (
              <Board stages={features.stages} features={features.items} projects={projects}
                onOpen={(f) => openFeature({ projectId: f.projectId, slug: f.slug })} />
            ) : focusedFeature ? (
              <FeaturePage feature={focusedFeature} sessions={sessions} onFocusSession={setFocused}
                onOpenArtifact={(name) => openArtifact({ projectId: focusedFeature.projectId, slug: focusedFeature.slug, path: name, hash: null })} />
            ) : focused?.lastStatus === 'running' ? (
              <TerminalView key={focused.id} sessionId={focused.id} />
            ) : focused ? (
              <div className={s.ended}>
                <div className={s.endedTitle}>Session ended</div>
                <Button icon="trash" onClick={() => void window.api.invoke('session:remove', { id: focused.id })}>Remove</Button>
              </div>
            ) : (
              <div className={s.empty}>Start a session with ＋ or ⌘T</div>
            )}
          </>
        }
        viewer={v ? (
          <ArtifactViewer target={v} groups={viewerFeature ? viewableFiles(viewerFeature, features.stages) : []}
            mtimeMs={viewerFeature ? viewerFeature.artifacts.find((a) => a.name === v.path)?.mtimeMs : undefined}
            expanded={ui.viewerExpanded} onToggleExpanded={toggleViewerExpanded} onReload={reloadViewer}
            onOpen={(path) => openArtifact({ projectId: v.projectId, slug: v.slug, path, hash: null })} onClose={closeViewer} />
        ) : undefined}
        sidebarWidth={ui.sidebarWidth}
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
