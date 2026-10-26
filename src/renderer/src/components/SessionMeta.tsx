import type { ReactNode } from 'react'
import type { Feature, Session } from '@shared/types'
import { featureStage } from '../featureLabels'
import { statusTone, statusView } from '../sessionStatus'
import { BranchMark, showsPr } from './BranchMark'
import { StatusDot } from './ui/StatusDot'
import { Tag } from './ui/Tag'
import s from './SessionMeta.module.css'

// The row that names a session, shared by the content header and a grid pane header so the two
// cannot drift: same facts, same order, same type. `lead` is whatever identifies it — the
// breadcrumb when the session is focused, "project / label" in a pane — and everything after it
// is the same in both. `family` adds a chip for a parent's active child: a click focuses it.
export function SessionMeta({ lead, session, feature, featureInLead, tagIndex, context, actions, family }: {
  lead: ReactNode
  session: Session
  feature?: Feature | null
  featureInLead?: boolean // the lead already names the feature, so only its colour and stage are repeated
  tagIndex?: number | null
  context?: ReactNode // ContextPopover in a header, ContextGauge in a pane: a density, not a difference
  actions?: ReactNode
  family?: { active: Session | null; onJump: (id: string) => void }
}) {
  const status = statusView(session)
  const child = family?.active ?? null
  return (
    <div className={s.row}>
      <div className={s.lead}>{lead}</div>
      {session.branch && (
        <span className={s.branch}>
          <BranchMark pr={session.pr} />
          {session.pr && showsPr(session.pr) && <a className={s.pr} href={session.pr.url} target="_blank" rel="noreferrer" title={`Pull request #${session.pr.number} (${session.pr.state})`}>#{session.pr.number}</a>}
          <span className={s.truncate}>{session.branch}</span>
        </span>
      )}
      {feature && (
        <span className={s.feature}>
          <Tag index={tagIndex ?? null}>{featureInLead ? null : <span className={s.truncate}>{feature.title}</span>}</Tag>
          <span className={s.secondary}>{featureStage(feature)}</span>
        </span>
      )}
      <span className={s.status}><StatusDot tone={status.tone} /><span className={s.secondary}>{status.label}</span></span>
      {/* a button, so the grid's drag handler leaves it alone */}
      {family && child && (
        <button type="button" className={s.child} aria-label={`Jump to child ${child.label}`}
          title={`${child.label} · ${statusView(child).label}`} onClick={() => family.onJump(child.id)}>
          <StatusDot tone={statusTone(child)} />
          <span className={s.truncate}>{child.label}</span>
        </button>
      )}
      <span className={s.spacer} />
      {context}
      {actions}
    </div>
  )
}