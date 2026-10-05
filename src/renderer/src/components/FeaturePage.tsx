import { isViewable } from '@shared/artifactUrl'
import type { Feature, Session } from '@shared/types'
import { CARD_STATE_LABELS, progressLabel } from '../featureLabels'
import { Badge } from './ui/Badge'
import { cx } from './ui/cx'
import { ListRow } from './ui/ListRow'
import s from './FeaturePage.module.css'

export function FeaturePage({ feature: f, sessions, onFocusSession, onOpenArtifact }: {
  feature: Feature
  sessions: Session[]
  onFocusSession: (id: string) => void
  onOpenArtifact: (name: string) => void
}) {
  const linked = sessions.filter((x) => x.projectId === f.projectId && x.feature === f.slug)

  return (
    <div className={s.page}>
      <header className={s.header}>
        <h1 className={s.title}>{f.title}</h1>
        <div className={s.meta}>
          <span>{f.slug} · {f.kind} · {f.flow ?? 'default'}</span>
          <Badge>{CARD_STATE_LABELS[f.cardState]}</Badge>
          {f.progress && <span>{progressLabel(f)}</span>}
          {f.flags.map((fl) => <Badge key={fl.id} tone="muted">{fl.label}</Badge>)}
        </div>
        {f.warnings.length > 0 && <div className={s.warning}>{f.warnings.join(' · ')}</div>}
      </header>

      <section className={s.section}>
        <h2 className={s.heading}>Stages</h2>
        <ol className={s.stages}>
          {f.stages.map((st) => (
            <li key={st.id} className={cx(s.stage, s[st.state])}>
              <span className={s.dot} />
              <span>{st.label}</span>
              {st.state === 'unapproved' && <span className={s.note}>unapproved</span>}
            </li>
          ))}
        </ol>
      </section>

      <section className={s.section}>
        <h2 className={s.heading}>Files</h2>
        <ul className={s.files}>
          {f.artifacts.map((a) => (
            <li key={a.name} className={s.file}>
              {isViewable(a.name)
                ? <button type="button" className={s.fileLink} onClick={() => onOpenArtifact(a.name)}>{a.name}</button>
                : <span>{a.name}</span>}
              {a.stage && <span className={s.note}>{a.stage}{a.role === 'review' ? ' · review' : ''}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className={s.section}>
        <h2 className={s.heading}>Sessions</h2>
        {linked.length === 0
          ? <div className={s.empty}>No linked sessions</div>
          : (
            <div className={s.sessions}>
              {linked.map((x) => (
                <ListRow key={x.id} title={x.label} status={{ label: x.lastStatus, tone: x.lastStatus }}
                  onClick={() => onFocusSession(x.id)} />
              ))}
            </div>
          )}
      </section>
    </div>
  )
}
