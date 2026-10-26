import type { ReactNode } from 'react'
import type { Feature, Session } from '@shared/types'
import type { Family } from '../family'
import { featureStage } from '../featureLabels'
import { statusTone, statusView } from '../sessionStatus'
import { BranchMark, showsPr } from './BranchMark'
import { ChildrenPopover } from './ChildrenPopover'
import { StatusDot } from './ui/StatusDot'
import { Tag } from './ui/Tag'
import { cx } from './ui/cx'
import s from './SessionMeta.module.css'

// The row that names a session, shared by the content header and a grid pane header so the two
// cannot drift: same facts, same order, same type. `lead` is whatever identifies it — the
// breadcrumb when the session is focused, "project / label" in a pane — and everything after it
// is the same in both. `trail` stacks it for the content header: the session's name and its facts
// on top, the trail it sits under and its branch on a second, smaller line. `family` adds chips: "↑ parent" on a child (running or ended), and on a
// parent its active child plus "N children", which lists them all; a click focuses one.
export function SessionMeta({ lead, trail, session, feature, featureInLead, tagIndex, context, actions, family }: {
  lead: ReactNode
  trail?: ReactNode
  session: Session
  feature?: Feature | null
  featureInLead?: boolean // the lead already names the feature, so only its colour and stage are repeated
  tagIndex?: number | null
  context?: ReactNode // ContextPopover in a header, ContextGauge in a pane: a density, not a difference
  actions?: ReactNode
  family?: Family & { onJump: (id: string) => void }
}) {
  const status = statusView(session)
  const parent = family?.parent ?? null
  const child = family?.active ?? null
  const branch = session.branch && (
    <span className={s.branch}>
      <BranchMark pr={session.pr} />
      {session.pr && showsPr(session.pr) && <a className={s.pr} href={session.pr.url} target="_blank" rel="noreferrer" title={`Pull request #${session.pr.number} (${session.pr.state})`}>#{session.pr.number}</a>}
      <span className={s.truncate}>{session.branch}</span>
    </span>
  )
  const facts = (
    <>
      {feature && (
        <span className={s.feature}>
          <Tag index={tagIndex ?? null}>{featureInLead ? null : <span className={s.truncate}>{feature.title}</span>}</Tag>
          <span className={s.secondary}>{featureStage(feature)}</span>
        </span>
      )}
      <span className={s.status}><StatusDot tone={status.tone} /><span className={s.secondary}>{status.label}</span></span>
      {/* buttons, so the grid's drag handler leaves them alone */}
      {family && parent && (
        <button type="button" className={s.chip} aria-label={`Jump to parent ${parent.label}`}
          title={`${parent.label} · ${statusView(parent).label}`} onClick={() => family.onJump(parent.id)}>
          <span>↑</span>
          <StatusDot tone={statusTone(parent)} />
          <span className={s.truncate}>{parent.label}</span>
        </button>
      )}
      {family && child && (
        <button type="button" className={s.chip} aria-label={`Jump to child ${child.label}`}
          title={`${child.label} · ${statusView(child).label}`} onClick={() => family.onJump(child.id)}>
          <StatusDot tone={statusTone(child)} />
          <span className={s.truncate}>{child.label}</span>
        </button>
      )}
      {family && family.children.length > 0 && <ChildrenPopover kids={family.children} onJump={family.onJump} />}
    </>
  )
  return (
    <div className={s.row}>
      {trail ? (
        <div className={s.lines}>
          <div className={s.line}><div className={cx(s.lead, s.name)}>{lead}</div>{facts}</div>
          <div className={cx(s.line, s.sub)}>{trail}{branch}</div>
        </div>
      ) : (
        <>
          <div className={s.lead}>{lead}</div>
          {branch}
          {facts}
        </>
      )}
      <span className={s.spacer} />
      {context}
      {actions}
    </div>
  )
}