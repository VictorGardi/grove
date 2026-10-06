import { useEffect, useState } from 'react'
import type { Feature, Project, Session } from '@shared/types'
import { duration, statusView, type StatusSince } from '../sessionStatus'
import { colorTags } from '../tags'
import { linkedFeature, sessionColumns } from '../tree'
import { Icon } from './ui/Icon'
import { ListRow } from './ui/ListRow'
import { Tag } from './ui/Tag'
import s from './Board.module.css'

// One project's sessions, one column per status (ADR 0018).
export function SessionsBoard({ sessions, features, projects, statusSince, onFocus, onOpenFeature }: {
  sessions: Session[] // the project's sessions
  features: Feature[] // the project's features
  projects: Project[]
  statusSince: Record<string, StatusSince>
  onFocus(id: string): void
  onOpenFeature(f: Feature): void
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const tags = colorTags(projects, features)
  const since = (x: Session) => (x.lastStatus === 'gone' && x.endedAt ? Date.parse(x.endedAt) : statusSince[x.id]?.since)

  return (
    <div className={s.board}>
      {sessionColumns(sessions).map((col) => (
        <section key={col.id} className={s.column}>
          <h2 className={s.heading}>{col.label} <span className={s.count}>{col.sessions.length}</span></h2>
          {col.sessions.map((x) => {
            const f = linkedFeature(x, features)
            const view = statusView(x)
            const t = since(x)
            return (
              <ListRow
                key={x.id}
                title={x.label}
                icon={<Icon name={x.kind === 'opencode' ? 'opencode' : 'terminal'} size={14} />}
                meta={f ? (
                  <span className={s.tags}>
                    <Tag index={tags.group(f.projectId, f.group ? f.slug : f.parent)} onClick={() => onOpenFeature(f)}>{f.title}</Tag>
                  </span>
                ) : undefined}
                status={{ ...view, label: t === undefined ? view.label : `${view.label} · ${duration(now - t)}` }}
                tone={col.id === 'waiting' ? 'waiting' : 'default'}
                onClick={() => onFocus(x.id)}
              />
            )
          })}
        </section>
      ))}
    </div>
  )
}
