import type { Feature, Project, Session } from '@shared/types'
import { statusTone, statusView } from '../sessionStatus'
import { colorTags } from '../tags'
import { linkedFeature, sessionColumns } from '../tree'
import { ListRow } from './ui/ListRow'
import { Tag } from './ui/Tag'
import { WorkflowStatusButton } from './ui/WorkflowStatusPicker'
import s from './Board.module.css'

// One project's sessions, one column per status (ADR 0018).
export function SessionsBoard({ sessions, features, projects, onFocus, onOpenFeature }: {
  sessions: Session[] // the project's sessions
  features: Feature[] // the project's features
  projects: Project[]
  onFocus(id: string): void
  onOpenFeature(f: Feature): void
}) {
  const tags = colorTags(projects, features)

  return (
    <div className={s.board}>
      {sessionColumns(sessions).map((col) => (
        <section key={col.id} className={s.column}>
          <h2 className={s.heading}>{col.label} <span className={s.count}>{col.sessions.length}</span></h2>
          {col.sessions.map((x) => {
            const f = linkedFeature(x, features)
            return (
              <ListRow
                key={x.id}
                title={x.label}
                icon={<WorkflowStatusButton session={x} />}
                meta={f ? (
                  <span className={s.tags}>
                    <Tag index={tags.group(f.projectId, f.group ? f.slug : f.parent)} onClick={() => onOpenFeature(f)}>{f.title}</Tag>
                  </span>
                ) : undefined}
                status={{ ...statusView(x), tone: statusTone(x) }}
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