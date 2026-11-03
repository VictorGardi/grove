import { isViewable } from '@shared/artifactUrl'
import type { Feature, Project, Session } from '@shared/types'
import { CARD_STATE_LABELS } from '../featureLabels'
import { repoHead, repoProjectIds } from '../repoGroups'
import { statusView } from '../sessionStatus'
import { reviewTarget } from '../viewerFiles'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { cx } from './ui/cx'
import { ListRow } from './ui/ListRow'
import s from './FeaturePage.module.css'

export function FeaturePage({ feature: f, sessions, projects, onFocusSession, onOpenArtifact }: {
  feature: Feature
  sessions: Session[]
  projects: Project[] // the feature is the repo's, so a worktree's session is one of its sessions
  onFocusSession: (id: string) => void
  onOpenArtifact: (name: string) => void
}) {
  // One card per (repo, slug), so the page behind it counts the whole repo's linked sessions.
  const scope = repoProjectIds(projects, repoHead(projects, f.projectId))
  const linked = sessions.filter((x) => scope.has(x.projectId) && x.feature === f.slug)
  const review = reviewTarget(f)

  return (
    <div className={s.page}>
      <header className={s.header}>
        <h1 className={s.title}>{f.title}</h1>
        {review && (
          <div className={s.actions}>
            <Button size="sm" onClick={() => onOpenArtifact(review)}>Open review</Button>
          </div>
        )}
        <div className={s.meta}>
          <span>{f.slug} · {f.kind} · {f.flow ?? 'default'}</span>
          <Badge>{CARD_STATE_LABELS[f.cardState]}</Badge>
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
                <ListRow key={x.id} title={x.label} status={statusView(x)}
                  onClick={() => onFocusSession(x.id)} />
              ))}
            </div>
          )}
      </section>
    </div>
  )
}
