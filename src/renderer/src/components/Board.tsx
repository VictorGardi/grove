import type { Feature, Project } from '@shared/types'
import { CARD_STATE_LABELS } from '../featureLabels'
import { boardColumns } from '../tree'
import { ListRow } from './ui/ListRow'
import s from './Board.module.css'

export function Board({ stages, features, projects, onOpen }: {
  stages: { id: string; label: string }[]
  features: Feature[]
  projects: Project[]
  onOpen(f: Feature): void
}) {
  const projectName = (id: string) => (projects.length > 1 ? projects.find((p) => p.id === id)?.name : undefined)
  return (
    <div className={s.board}>
      {boardColumns(stages, features).map(({ stage, cards }) => (
        <section key={stage.id} className={s.column}>
          <h2 className={s.heading}>{stage.label} <span className={s.count}>{cards.length}</span></h2>
          {cards.map(({ feature, epic }) => (
            <ListRow
              key={feature.projectId + '/' + feature.slug}
              title={feature.title}
              meta={[projectName(feature.projectId), epic].filter(Boolean).join(' · ') || undefined}
              status={{ label: CARD_STATE_LABELS[feature.cardState], tone: 'idle' }}
              onClick={() => onOpen(feature)}
            />
          ))}
        </section>
      ))}
    </div>
  )
}
