import { useState } from 'react'
import type { SessionKind } from '@shared/types'
import { useSlices } from '../stores/slices'
import { Button } from './ui/Button'
import { cx } from './ui/cx'
import { Modal } from './ui/Modal'
import s from './NewSessionModal.module.css'

const kinds: { kind: SessionKind; label: string; icon: 'opencode' | 'terminal' }[] = [
  { kind: 'opencode', label: 'OpenCode', icon: 'opencode' },
  { kind: 'terminal', label: 'Terminal', icon: 'terminal' },
]

export function NewSessionModal({ onClose, initialProjectId }: { onClose: () => void; initialProjectId?: string }) {
  const { projects, setFocused } = useSlices()
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? '')
  const [kind, setKind] = useState<SessionKind>('opencode')
  const [error, setError] = useState<string | null>(null)

  async function create() {
    const res = await window.api.invoke('session:create', { projectId, kind, cols: 120, rows: 40 })
    if (!res.ok) return setError(res.error)
    setFocused(res.data.id)
    onClose()
  }

  return (
    <Modal onClose={onClose} onConfirm={projects.length ? () => void create() : undefined}>
      {projects.length === 0 ? (
        <div className={s.hint}>Add a project first</div>
      ) : (
        <>
          <div className={s.title}>New session</div>
          <label className={s.field}>
            <span className={s.caption}>Project</span>
            <select className={s.select} value={projectId} onChange={(e) => setProjectId(e.target.value)} autoFocus>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className={s.kinds} role="radiogroup">
            {kinds.map((k) => (
              <Button
                key={k.kind}
                icon={k.icon}
                role="radio"
                aria-checked={kind === k.kind}
                className={cx(s.kind, kind === k.kind && s.kindOn)}
                onClick={() => setKind(k.kind)}
              >
                {k.label}
              </Button>
            ))}
          </div>
          {error && <div className={s.error}>{error}</div>}
          <div className={s.footer}>
            <Button variant="primary" onClick={() => void create()}>Create ↵</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
