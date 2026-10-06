import type { Feature, Project } from '@shared/types'
import { CARD_STATE_LABELS } from '../featureLabels'
import { colorTags } from '../tags'
import { boardColumns } from '../tree'
import { ListRow } from './ui/ListRow'
import { Tag } from './ui/Tag'
import s from './Board.module.css'

// One project's features, one column per workflow stage.
export function Board({ stages, features, projects, onOpen }: {
  stages: { id: string; label: string }[]
  features: Feature[] // the project's features
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
            <ListRow
              key={feature.projectId + '/' + feature.slug}
              title={feature.title}
              meta={parent ? (
                <span className={s.tags}>
                  <Tag index={tags.group(parent.projectId, parent.slug)} onClick={() => onOpen(parent)}>{parent.title}</Tag>
                </span>
              ) : undefined}
              status={{ label: CARD_STATE_LABELS[feature.cardState], tone: 'idle' }}
              onClick={() => onOpen(feature)}
            />
          ))}
        </section>
      ))}
    </div>
  )
}
