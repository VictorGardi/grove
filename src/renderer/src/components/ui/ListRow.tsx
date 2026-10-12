import type { MouseEvent, ReactNode } from 'react'
import { cx } from './cx'
import { StatusDot, type StatusTone } from './StatusDot'
import { splitTitleLead } from './titleLead'
import s from './ListRow.module.css'

interface Props {
  title: string
  corner?: ReactNode // floating on the top-left corner, shown on hover (or always with cornerPinned)
  cornerPinned?: boolean
  icon?: ReactNode
  meta?: ReactNode
  status?: { label: string; tone: StatusTone }
  picked?: boolean // part of a multi-selection
  tone?: 'default' | 'selected' | 'waiting' | 'finished'
  compact?: boolean
  mark?: { icon: ReactNode; label: string } // a small mark in the bottom-right corner, left of the status dot
  actions?: ReactNode // floating buttons on the card's top-right corner, shown on hover
  badge?: ReactNode // right of the title
  tab?: ReactNode // a handle hanging off the card's bottom edge, centred
  onClick?: (e: MouseEvent) => void
  onContextMenu?: (e: MouseEvent) => void
  onTitleDoubleClick?: () => void
  editor?: ReactNode // replaces the title while renaming
}

function Title({ title }: { title: string }) {
  const { lead, rest } = splitTitleLead(title)
  return lead ? <><span className={s.lead}>{lead}</span>{rest}</> : <>{title}</>
}

export function ListRow({ title, corner, cornerPinned, icon, meta, status, tone = 'default', picked, compact, mark, actions, badge, tab, onClick, onContextMenu, onTitleDoubleClick, editor }: Props) {
  return (
    <div className={cx(s.row, s[tone], compact && s.compact, !compact && status && !meta && s.hasDot, mark && s.hasMark, !!tab && s.hasTab, picked && s.picked)} onClick={onClick} onContextMenu={onContextMenu}>
      <div className={s.head}>
        {icon && <span className={s.icon}>{icon}</span>}
        {editor ?? <span className={s.title} onDoubleClick={onTitleDoubleClick}><Title title={title} /></span>}
        {compact && status && <StatusDot tone={status.tone} />}
        {badge}
      </div>
      {corner && <div className={cx(s.corner, cornerPinned && s.cornerPinned)} onClick={(e) => e.stopPropagation()}>{corner}</div>}
      {actions && <div className={s.actions} onClick={(e) => e.stopPropagation()}>{actions}</div>}
      {tab && <div className={s.tab} onClick={(e) => e.stopPropagation()}>{tab}</div>}
      {!compact && meta && <div className={cx(s.meta, status && s.metaClearOfDot)}>{meta}</div>}
      {!compact && mark && <span className={cx(s.mark, status && s.markBesideDot)} title={mark.label} aria-label={mark.label}>{mark.icon}</span>}
      {!compact && status && <span className={cx(s.statusDot, s[`s-${status.tone}`])} aria-label={status.label} title={status.label} />}
    </div>
  )
}
