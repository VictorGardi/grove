import type { Feature, Project } from '@shared/types'
import { CARD_STATE_LABELS } from '../featureLabels'
import { colorTags } from '../tags'
import { boardColumns } from '../tree'
import { ListRow } from './ui/ListRow'
import { Tag } from './ui/Tag'
import s from './Board.module.css'

export function Board({ stages, features, projects, onOpen }: {
  stages: { id: string; label: string }[]
  features: Feature[]
  projects: Project[]
  onOpen(f: Feature): void
}) {
  const tags = colorTags(projects, features)
  const projectName = (id: string) => (projects.length > 1 ? projects.find((p) => p.id === id)?.name : undefined)
  return (
    <div className={s.board}>
      {boardColumns(stages, features).map(({ stage, cards }) => (
        <section key={stage.id} className={s.column}>
          <h2 className={s.heading}>{stage.label} <span className={s.count}>{cards.length}</span></h2>
          {cards.map(({ feature, epic }) => {
            const project = projectName(feature.projectId)
            return (
              <ListRow
                key={feature.projectId + '/' + feature.slug}
                title={feature.title}
                meta={project || epic ? (
                  <span className={s.tags}>
                    {project && <Tag index={tags.project(feature.projectId)}>{project}</Tag>}
                    {epic && <Tag index={tags.group(feature.projectId, feature.parent)}>{epic}</Tag>}
                  </span>
                ) : undefined}
                status={{ label: CARD_STATE_LABELS[feature.cardState], tone: 'idle' }}
                onClick={() => onOpen(feature)}
              />
            )
          })}
        </section>
      ))}
    </div>
  )
}
