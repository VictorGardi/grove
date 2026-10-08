import type { Feature, Project, Session } from '@shared/types'
import { CARD_STATE_LABELS, CARD_STATE_TONES } from '../featureLabels'
import { shownStatus, statusView } from '../sessionStatus'
import { colorTags } from '../tags'
import { boardColumns, linkedSessions } from '../tree'
import { cx } from './ui/cx'
import { StatusDot } from './ui/StatusDot'
import { Tag } from './ui/Tag'
import s from './Board.module.css'

function FeatureCard({ feature: f, parent, parentTag, sessions, onOpen, onOpenParent }: {
  feature: Feature
  parent: Feature | null
  parentTag: number | null
  sessions: Session[] // linked to this feature
  onOpen(): void
  onOpenParent(): void
}) {
  const waiting = sessions.some((x) => shownStatus(x) === 'waiting')
  return (
    <div className={cx(s.card, waiting && s.waiting)} onClick={onOpen}>
      <div className={s.state}>
        <StatusDot tone={CARD_STATE_TONES[f.cardState]} />
        {CARD_STATE_LABELS[f.cardState]}
      </div>
      <div className={s.title}>{f.title}</div>
      {parent && (
        <span className={s.tags}>
          <Tag index={parentTag} onClick={onOpenParent}>{parent.title}</Tag>
        </span>
      )}
      {waiting && <div className={s.strip}>Input required</div>}
      {sessions.length > 0 && (
        <div className={s.dots}>
          {sessions.map((x) => (
            <span key={x.id} title={`${x.label} · ${statusView(x).label}`}><StatusDot tone={statusView(x).tone} /></span>
          ))}
        </div>
      )}
    </div>
  )
}

// One project's features, one column per workflow stage.
export function Board({ stages, features, sessions, projects, onOpen }: {
  stages: { id: string; label: string }[]
  features: Feature[] // the project's features
  sessions: Session[] // the project's sessions
  projects: Project[]
  onOpen(f: Feature): void
}) {
  const tags = colorTags(projects, features)
  return (
    <div className={s.board}>
      {boardColumns(stages, features).map(({ stage, cards }) => (
        <section key={stage.id} className={s.column}>
          <h2 className={s.heading}>{stage.label} <span className={s.count}>{cards.length}</span></h2>
          {cards.map(({ feature, parent }) => (
            <FeatureCard
              key={feature.projectId + '/' + feature.slug}
              feature={feature}
              parent={parent}
              parentTag={parent && tags.group(parent.projectId, parent.slug)}
              sessions={linkedSessions(feature, sessions)}
              onOpen={() => onOpen(feature)}
              onOpenParent={() => parent && onOpen(parent)}
            />
          ))}
        </section>
      ))}
    </div>
  )
}
