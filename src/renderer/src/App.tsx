import { useEffect, useState } from 'react'
import type { Session } from '@shared/types'
import { ConfirmDialog } from './components/ConfirmDialog'
import { NewSessionModal } from './components/NewSessionModal'
import { Sidebar } from './components/Sidebar'
import { TerminalView } from './components/TerminalView'
import { AppShell } from './components/shell/AppShell'
import { ContentHeader } from './components/shell/ContentHeader'
import { TopBar } from './components/shell/TopBar'
import { sidebarOrder } from './sidebarOrder'
import { useSlices } from './stores/slices'
import s from './App.module.css'

export default function App() {
  const { projects, sessions, ui, errors, hydrate, setFocused } = useSlices()
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmKill, setConfirmKill] = useState<Session | null>(null)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    return window.api.on('menu:action', (a) => {
      // read the latest state, not this effect's closure
      const { projects, sessions, ui } = useSlices.getState()
      if (a.type === 'newSession') setModalOpen(true)
      else if (a.type === 'closeSession') {
        const focused = sessions.find((x) => x.id === ui.focusedSessionId)
        if (focused?.lastStatus === 'running') setConfirmKill(focused)
      } else if (a.type === 'focusIndex') {
        const target = sidebarOrder(projects, sessions)[a.n - 1]
        if (target) setFocused(target.id)
      }
    })
  }, [setFocused])

  const focused = sessions.find((x) => x.id === ui.focusedSessionId)
  const project = focused && projects.find((p) => p.id === focused.projectId)
  const crumbs = focused ? [...(project ? [project.name] : []), focused.label] : []

  return (
    <>
      <AppShell
        topBar={<TopBar onNew={() => setModalOpen(true)} />}
        banners={errors.map((e, i) => (
          <div key={i} style={{ background: '#5a1d1d', color: '#f48771', padding: '4px 8px' }}>{e}</div>
        ))}
        sidebar={<Sidebar />}
        content={
          <>
            <ContentHeader crumbs={crumbs} />
            {focused?.lastStatus === 'running' ? (
              <TerminalView key={focused.id} sessionId={focused.id} />
            ) : focused ? (
              <div className={s.ended}>
                <div>Session ended</div>
                <button onClick={() => void window.api.invoke('session:remove', { id: focused.id })}>Remove</button>
              </div>
            ) : (
              <div className={s.empty} />
            )}
          </>
        }
        sidebarWidth={ui.sidebarWidth}
      />
      {modalOpen && <NewSessionModal onClose={() => setModalOpen(false)} />}
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
