import { useEffect, useState } from 'react'
import type { Session } from '@shared/types'
import { ConfirmDialog } from './components/ConfirmDialog'
import { NewSessionModal } from './components/NewSessionModal'
import { Sidebar } from './components/Sidebar'
import { TerminalView } from './components/TerminalView'
import { sidebarOrder } from './sidebarOrder'
import { useSlices } from './stores/slices'

export default function App() {
  const { sessions, ui, errors, hydrate, setFocused } = useSlices()
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
        const focused = sessions.find((s) => s.id === ui.focusedSessionId)
        if (focused?.lastStatus === 'running') setConfirmKill(focused)
      } else if (a.type === 'focusIndex') {
        const target = sidebarOrder(projects, sessions)[a.n - 1]
        if (target) setFocused(target.id)
      }
    })
  }, [setFocused])

  const focused = sessions.find((s) => s.id === ui.focusedSessionId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {errors.map((e, i) => (
        <div key={i} style={{ background: '#5a1d1d', color: '#f48771', padding: '4px 8px' }}>{e}</div>
      ))}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar />
        {focused?.lastStatus === 'running' ? (
          <TerminalView key={focused.id} sessionId={focused.id} />
        ) : focused ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <div>Session ended</div>
            <button onClick={() => void window.api.invoke('session:remove', { id: focused.id })}>Remove</button>
          </div>
        ) : (
          <div style={{ flex: 1 }} />
        )}
      </div>
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
    </div>
  )
}
