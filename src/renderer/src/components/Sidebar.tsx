import { useSlices } from '../stores/slices'

export function Sidebar() {
  const { projects, sessions, ui, focusedId, setFocused } = useSlices()

  return (
    <div style={{ width: ui.sidebarWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #333' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {projects.map((p) => (
          <div key={p.id} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, padding: '4px 0' }} title={p.path}>{p.name}</div>
            {sessions.filter((s) => s.projectId === p.id).map((s) => (
              <div
                key={s.id}
                onClick={() => setFocused(s.id)}
                style={{
                  display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 8px', cursor: 'pointer',
                  borderRadius: 4, background: s.id === focusedId ? '#37373d' : 'transparent',
                }}
              >
                <span>{s.label}</span>
                <span style={{ color: s.lastStatus === 'running' ? '#89d185' : '#888', fontSize: 11 }}>{s.lastStatus}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <button style={{ margin: 8 }} onClick={() => void window.api.invoke('project:add')}>Add project</button>
    </div>
  )
}
