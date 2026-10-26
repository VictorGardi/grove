import type { ArtifactCard, ArtifactCluster } from '../artifactsBoard'
import s from './ArtifactsBoard.module.css'

// A repo's artifacts: one labelled cluster per feature in the features board's order, a title card per file.
export function ArtifactsBoard({ clusters, stages, onOpen }: {
  clusters: ArtifactCluster[]
  stages: { id: string; label: string }[]
  onOpen(cluster: ArtifactCluster, card: ArtifactCard): void
}) {
  if (clusters.length === 0) return <div className={s.empty}>No artifacts yet</div>
  const label = (stage: string | null) => stages.find((st) => st.id === stage)?.label ?? 'Other'
  return (
    <div className={s.board}>
      {clusters.map((c) => (
        <section key={c.feature.projectId + '/' + c.feature.slug} className={s.cluster}>
          <h2 className={s.heading}>{c.feature.title} <span className={s.count}>{c.cards.length}</span></h2>
          <div className={s.cards}>
            {c.cards.map((card) => (
              <button key={card.path} type="button" className={s.card} onClick={() => onOpen(c, card)}>
                <span className={s.stage}>{label(card.stage)}</span>
                <span className={s.name}>{card.name}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
