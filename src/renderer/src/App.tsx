import { useEffect, useState } from 'react'
import { NewSessionModal } from './components/NewSessionModal'
import { Sidebar } from './components/Sidebar'
import { TerminalView } from './components/TerminalView'
import { useSlices } from './stores/slices'

export default function App() {
  const { sessions, ui, errors, hydrate } = useSlices()
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    void hydrate()
    return window.api.on('menu:action', (a) => {
      if (a.type === 'newSession') setModalOpen(true)
    })
  }, [hydrate])

  const focused = sessions.find((s) => s.id === ui.focusedSessionId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {errors.map((e, i) => (
        <div key={i} style={{ background: '#5a1d1d', color: '#f48771', padding: '4px 8px' }}>{e}</div>
      ))}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar />
        {focused?.lastStatus === 'running' ? <TerminalView key={focused.id} sessionId={focused.id} /> : <div style={{ flex: 1 }} />}
      </div>
      {modalOpen && <NewSessionModal onClose={() => setModalOpen(false)} />}
    </div>
  )
}
