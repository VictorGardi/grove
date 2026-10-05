import { useState } from 'react'
import type { Session } from '@shared/types'
import { useSlices } from '../stores/slices'
import { ListRow } from './ui/ListRow'
import { Modal } from './ui/Modal'
import s from './LinkPicker.module.css'

// Links a session to a feature in its project, or unlinks it (None). Both pin.
export function LinkPicker({ session, onClose }: { session: Session; onClose: () => void }) {
  const { features } = useSlices()
  const [error, setError] = useState<string | null>(null)
  const own = features.items.filter((f) => f.projectId === session.projectId)

  async function pick(feature: string | null) {
    const res = await window.api.invoke('session:link', { id: session.id, feature })
    if (res.ok) onClose()
    else setError(res.error)
  }

  return (
    <Modal onClose={onClose} width="sm">
      <div className={s.title}>Link session</div>
      <div className={s.list}>
        {own.map((f) => (
          <ListRow key={f.slug} title={f.title} meta={f.slug}
            tone={session.feature === f.slug ? 'selected' : 'default'} onClick={() => void pick(f.slug)} />
        ))}
        <ListRow title="None" tone={session.feature === null ? 'selected' : 'default'} onClick={() => void pick(null)} />
      </div>
      {error && <div className={s.error}>{error}</div>}
    </Modal>
  )
}
