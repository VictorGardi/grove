import type { Feature, Project, Session } from '@shared/types'
import { CARD_STATE_LABELS, CARD_STATE_TONES } from '../featureLabels'
import { divergentCopies, type Checkout, type UnionFeature } from '../featureUnion'
import { repoProjectIds } from '../repoGroups'
import { shownStatus, statusView } from '../sessionStatus'
import { colorTags } from '../tags'
import { boardColumns, linkedSessions } from '../tree'
import { cx } from './ui/cx'
import { StatusDot } from './ui/StatusDot'
import { Tag } from './ui/Tag'
import s from './Board.module.css'

function FeatureCard({ feature: f, parent, parentTag, sessions, divergent, onOpen, onOpenCopy, onOpenParent }: {
  feature: UnionFeature
  parent: UnionFeature | null
  parentTag: number | null
  sessions: Session[] // linked to this feature, in any of the repo's checkouts
  divergent: Checkout[] // copies sitting at another stage
  onOpen(): void
  onOpenCopy(c: Checkout): void
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
      {(parent || divergent.length > 0) && (
        <span className={s.tags}>
          {parent && <Tag index={parentTag} onClick={onOpenParent}>{parent.title}</Tag>}
          {divergent.map((c) => (
            <button key={c.projectId} type="button" className={s.chip}
              title={`This feature is also at another stage in ${c.name}`}
              onClick={(e) => { e.stopPropagation(); onOpenCopy(c) }}>
              also edited in {c.name}
            </button>
          ))}
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

// One repo's features, one column per workflow stage. The cards are already unioned — one per
// (repo, slug), the checkout's copy canonical, a divergent worktree copy behind a chip (D3) —
// so the repo's sessions are one card's dots however many checkouts ran them.
export function Board({ stages, features, sessions, projects, onOpen }: {
  stages: { id: string; label: string }[]
  features: UnionFeature[] // the repo's cards
  sessions: Session[] // the repo's sessions
  projects: Project[]
  onOpen(f: Feature): void // a card, or the copy a chip or a parent tag names
}) {
  const tags = colorTags(projects, features)
  const repo = features.length > 0 ? repoProjectIds(projects, features[0].headId) : undefined
  return (
    <div className={s.board}>
      {boardColumns(stages, features, repo).map(({ stage, cards }) => (
        <section key={stage.id} className={s.column}>
          <h2 className={s.heading}>{stage.label} <span className={s.count}>{cards.length}</span></h2>
          {cards.map(({ feature, parent }) => (
            <FeatureCard
              key={feature.headId + '/' + feature.slug}
              feature={feature}
              parent={parent}
              parentTag={parent && tags.group(parent.projectId, parent.slug)}
              sessions={linkedSessions(feature, sessions, repo)}
              divergent={divergentCopies(feature)}
              onOpen={() => onOpen(feature)}
              onOpenCopy={(c) => onOpen(c.feature)}
              onOpenParent={() => parent && onOpen(parent)}
            />
          ))}
        </section>
      ))}
    </div>
  )
}
