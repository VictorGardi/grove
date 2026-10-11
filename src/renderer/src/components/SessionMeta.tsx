import type { ReactNode } from 'react'
import type { Feature, Session } from '@shared/types'
import { featureStage } from '../featureLabels'
import { statusView } from '../sessionStatus'
import { Icon } from './ui/Icon'
import { SandboxMark } from './ui/SandboxMark'
import { StatusDot } from './ui/StatusDot'
import { Tag } from './ui/Tag'
import s from './SessionMeta.module.css'

// The row that names a session, shared by the content header and a grid pane header so the two
// cannot drift: same facts, same order, same type. `lead` is whatever identifies it — the
// breadcrumb when the session is focused, "project / label" in a pane — and everything after it
// is the same in both, down to the density of the sandbox mark.
export function SessionMeta({ lead, session, feature, tagIndex, context, dense, actions }: {
  lead: ReactNode
  session: Session
  feature?: Feature | null
  tagIndex?: number | null
  context?: ReactNode // ContextPopover in a header, ContextGauge in a pane: a density, not a difference
  dense?: boolean
  actions?: ReactNode
}) {
  const status = statusView(session)
  return (
    <div className={s.row}>
      <div className={s.lead}>{lead}</div>
      {session.branch && (
        <span className={s.branch}><Icon name="branch" size={12} /><span className={s.truncate}>{session.branch}</span></span>
      )}
      {feature && (
        <span className={s.feature}>
          <Tag index={tagIndex ?? null}>{feature.title}</Tag>
          <span className={s.secondary}>{featureStage(feature)}</span>
        </span>
      )}
      <span className={s.status}><StatusDot tone={status.tone} /><span className={s.secondary}>{status.label}</span></span>
      <span className={s.spacer} />
      {context}
      <SandboxMark sandboxed={session.sandboxed} compact={dense} />
      {actions}
    </div>
  )
}