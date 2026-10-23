import { useState } from 'react'
import type { Session } from '@shared/types'
import { errorMessage } from '@shared/sessionErrors'
import { parentOptions } from '../parentOptions'
import { useSlices } from '../stores/slices'
import { colorTags } from '../tags'
import { cx } from './ui/cx'
import { ListRow } from './ui/ListRow'
import { Modal } from './ui/Modal'
import { tagClass } from './ui/Tag'
import s from './LinkPicker.module.css'

// Puts a session in another's group (taking it out is the card menu's Clear parent). Groups are one level deep, so only
// sessions that lead no group of their own and are not children themselves are offered.
export function ParentPicker({ session, onClose }: { session: Session; onClose: () => void }) {
  const { projects, sessions, features } = useSlices()
  const [error, setError] = useState<string | null>(null)
  const runs = parentOptions(projects, sessions, session)
  const tags = colorTags(projects, features.items)

  async function pick(parent: string) {
    const res = await window.api.invoke('session:setParent', { id: session.id, parent })
    if (res.ok) onClose()
    else setError(errorMessage(res.error))
  }

  return (
    <Modal onClose={onClose} width="sm">
      <div className={s.title}>Set parent</div>
      <div className={s.list}>
        {runs.map(({ project, sessions: list }) => {
          const tone = tagClass(tags.project(project.id), 'fg')
          return (
            <div key={project.id} className={s.run}>
              <div className={cx(s.heading, tone)}>{project.name}</div>
              <div className={s.runBody}>
                <span className={cx(s.bar, tone)} />
                <div className={s.runRows}>
                  {list.map((o) => (
                    <ListRow key={o.id} title={o.label} meta={o.branch ?? undefined}
                      tone={session.parentId === o.id ? 'selected' : 'default'} onClick={() => void pick(o.id)} />
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {error && <div className={s.error}>{error}</div>}
    </Modal>
  )
}
