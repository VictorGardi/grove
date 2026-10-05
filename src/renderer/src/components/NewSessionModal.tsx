import { useEffect, useState } from 'react'
import type { SessionKind } from '@shared/types'
import { useSlices } from '../stores/slices'

export function NewSessionModal({ onClose }: { onClose: () => void }) {
  const { projects, setFocused } = useSlices()
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [kind, setKind] = useState<SessionKind>('opencode')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function create() {
    const res = await window.api.invoke('session:create', { projectId, kind, cols: 120, rows: 40 })
    if (!res.ok) return setError(res.error)
    setFocused(res.data.id)
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 120 }} onClick={onClose}>
      <div style={{ background: '#252526', padding: 16, borderRadius: 6, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }} onClick={(e) => e.stopPropagation()}>
        {projects.length === 0 ? (
          <div>Add a project first</div>
        ) : (
          <>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} autoFocus>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <label>
              <input type="radio" checked={kind === 'opencode'} onChange={() => setKind('opencode')} /> OpenCode
            </label>
            <label>
              <input type="radio" checked={kind === 'terminal'} onChange={() => setKind('terminal')} /> Terminal
            </label>
            {error && <div style={{ color: '#f48771' }}>{error}</div>}
            <button onClick={() => void create()}>Create</button>
          </>
        )}
      </div>
    </div>
  )
}
