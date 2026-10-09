import type { MouseEvent, ReactNode } from 'react'
import { cx } from './cx'
import { StatusDot, type StatusTone } from './StatusDot'
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
  actions?: ReactNode // floating buttons on the card's top-right corner, shown on hover
  badge?: ReactNode // right of the title
  onClick?: (e: MouseEvent) => void
  onContextMenu?: (e: MouseEvent) => void
  onTitleDoubleClick?: () => void
  editor?: ReactNode // replaces the title while renaming
}

export function ListRow({ title, corner, cornerPinned, icon, meta, status, tone = 'default', picked, compact, actions, badge, onClick, onContextMenu, onTitleDoubleClick, editor }: Props) {
  return (
    <div className={cx(s.row, s[tone], compact && s.compact, picked && s.picked)} onClick={onClick} onContextMenu={onContextMenu}>
      <div className={s.head}>
        {icon}
        {editor ?? <span className={s.title} onDoubleClick={onTitleDoubleClick}>{title}</span>}
        {compact && status && <StatusDot tone={status.tone} />}
        {badge}
      </div>
      {corner && <div className={cx(s.corner, cornerPinned && s.cornerPinned)} onClick={(e) => e.stopPropagation()}>{corner}</div>}
      {actions && <div className={s.actions} onClick={(e) => e.stopPropagation()}>{actions}</div>}
      {!compact && meta && <div className={s.meta}>{meta}</div>}
      {!compact && status && <span className={cx(s.statusDot, s[`s-${status.tone}`])} aria-label={status.label} title={status.label} />}
    </div>
  )
}
