import { useState } from 'react'
import type { Session } from '@shared/types'
import { useSlices } from '../stores/slices'
import { sessionsOf } from '../sidebarOrder'

const linkButton = { background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 11, padding: 0 }

function SessionRow({ s, focused, onFocus }: { s: Session; focused: boolean; onFocus: () => void }) {
  const [editing, setEditing] = useState(false)

  return (
    <div
      onClick={onFocus}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px', cursor: 'pointer',
        borderRadius: 4, background: focused ? '#37373d' : 'transparent',
      }}
    >
      {editing ? (
        <input
          autoFocus
          defaultValue={s.label}
          style={{ flex: 1, minWidth: 0 }}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const label = e.currentTarget.value.trim()
              if (label) void window.api.invoke('session:rename', { id: s.id, label })
              setEditing(false)
            } else if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onDoubleClick={() => setEditing(true)}>
          {s.label}
        </span>
      )}
      {s.lastStatus === 'gone' && (
        <button style={linkButton} onClick={(e) => { e.stopPropagation(); void window.api.invoke('session:remove', { id: s.id }) }}>
          Remove
        </button>
      )}
      <span style={{ color: s.lastStatus === 'running' ? '#89d185' : '#888', fontSize: 11 }}>{s.lastStatus}</span>
    </div>
  )
}

export function Sidebar() {
  const { projects, sessions, ui, setFocused } = useSlices()
  const [refused, setRefused] = useState<string | null>(null)

  async function removeProject(id: string) {
    const res = await window.api.invoke('project:remove', { id })
    setRefused(res.ok ? null : id)
  }

  return (
    <div style={{ width: ui.sidebarWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #333' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {projects.map((p) => (
          <div key={p.id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
              <span style={{ flex: 1, fontWeight: 600 }} title={p.path}>{p.name}</span>
              <button style={linkButton} onClick={() => void removeProject(p.id)}>Remove project</button>
            </div>
            {refused === p.id && (
              <div style={{ color: '#f48771', fontSize: 11, paddingBottom: 4 }}>Can't remove: project has running sessions</div>
            )}
            {sessionsOf(p.id, sessions).map((s) => (
              <SessionRow key={s.id} s={s} focused={s.id === ui.focusedSessionId} onFocus={() => setFocused(s.id)} />
            ))}
          </div>
        ))}
      </div>
      <button style={{ margin: 8 }} onClick={() => void window.api.invoke('project:add')}>Add project</button>
    </div>
  )
}
