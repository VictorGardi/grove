import type { MouseEvent, ReactNode } from 'react'
import { cx } from './cx'
import type { StatusTone } from './StatusDot'
import { splitTitleLead } from './titleLead'
import s from './SessionRow.module.css'

// A session's row in the sidebar, on one grid shared by every row so each fact sits in the
// same place down the list: the workflow icon over the grid mark on the left, title and time in
// status on the first line, meta (branch) on the second, the live dot on the right edge.
// Compacted, it keeps only the first line.
interface Props {
  title: string
  icon: ReactNode
  time: { label: string; title: string } // time in the current status
  status: { label: string; tone: StatusTone }
  meta?: ReactNode // line two, left
  slot?: ReactNode // line two, under the icon: the grid mark
  tone?: 'default' | 'selected' | 'waiting'
  picked?: boolean // part of a multi-selection
  compact?: boolean
  actions?: ReactNode // floating over the first line's right end, shown on hover
  onClick?: (e: MouseEvent) => void
  onContextMenu?: (e: MouseEvent) => void
  onTitleDoubleClick?: () => void
  editor?: ReactNode // replaces the title while renaming
}

function Title({ title }: { title: string }) {
  const { lead, rest } = splitTitleLead(title)
  return lead ? <><span className={s.lead}>{lead}</span>{rest}</> : <>{title}</>
}

export function SessionRow({ title, icon, time, status, meta, slot, tone = 'default', picked, compact, actions, onClick, onContextMenu, onTitleDoubleClick, editor }: Props) {
  return (
    <div className={cx(s.row, s[tone], compact && s.compact, picked && s.picked)} onClick={onClick} onContextMenu={onContextMenu}>
      <span className={s.icon}>{icon}</span>
      {editor ?? <span className={s.title} onDoubleClick={onTitleDoubleClick}><Title title={title} /></span>}
      <span className={cx(s.time, s[`t-${status.tone}`])} title={time.title}>{time.label}</span>
      <span className={cx(s.dot, s[`s-${status.tone}`])} aria-label={status.label} title={status.label} />
      {!compact && <div className={s.meta}>{meta}</div>}
      {!compact && slot && <div className={s.slot} onClick={(e) => e.stopPropagation()}>{slot}</div>}
      {actions && <div className={s.actions} onClick={(e) => e.stopPropagation()}>{actions}</div>}
    </div>
  )
}
