import { useEffect, useState } from 'react'
import type { Session } from '@shared/types'
import { ConfirmDialog } from './components/ConfirmDialog'
import { NewSessionModal } from './components/NewSessionModal'
import { Sidebar } from './components/Sidebar'
import { TerminalView } from './components/TerminalView'
import { AppShell } from './components/shell/AppShell'
import { ContentHeader } from './components/shell/ContentHeader'
import { TopBar } from './components/shell/TopBar'
import { Banner } from './components/ui/Banner'
import { Button } from './components/ui/Button'
import { sidebarOrder } from './sidebarOrder'
import { useSlices } from './stores/slices'
import s from './App.module.css'

export default function App() {
  const { projects, sessions, ui, features, errors, hydrate, setFocused } = useSlices()
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
        const target = sidebarOrder(projects, sessions)[a.n - 1]
        if (target) setFocused(target.id)
      }
    })
  }, [setFocused])

  const openNew = (projectId?: string) => setNewFor({ projectId })
  const focused = sessions.find((x) => x.id === ui.focusedSessionId)
  const project = focused && projects.find((p) => p.id === focused.projectId)
  const crumbs = focused ? [...(project ? [project.name] : []), focused.label] : []

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
            <ContentHeader crumbs={crumbs} />
            {focused?.lastStatus === 'running' ? (
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
        sidebarWidth={ui.sidebarWidth}
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
