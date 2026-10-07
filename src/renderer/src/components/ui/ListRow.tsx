import type { ReactNode } from 'react'
import { cx } from './cx'
import { StatusDot, type StatusTone } from './StatusDot'
import s from './ListRow.module.css'

interface Props {
  title: string
  leading?: ReactNode // before the icon, e.g. a toggle
  icon?: ReactNode
  meta?: ReactNode
  status?: { label: string; tone: StatusTone }
  tone?: 'default' | 'selected' | 'waiting' | 'finished' | 'muted'
  compact?: boolean
  actions?: ReactNode // floating buttons on the card's top-right corner, shown on hover
  badge?: ReactNode // right of the title
  onClick?: () => void
  onTitleDoubleClick?: () => void
  editor?: ReactNode // replaces the title while renaming
}

export function ListRow({ title, leading, icon, meta, status, tone = 'default', compact, actions, badge, onClick, onTitleDoubleClick, editor }: Props) {
  return (
    <div className={cx(s.row, s[tone], compact && s.compact)} onClick={onClick}>
      <div className={s.head}>
        {leading}
        {icon}
        {editor ?? <span className={s.title} onDoubleClick={onTitleDoubleClick}>{title}</span>}
        {compact && status && <StatusDot tone={status.tone} />}
        {badge}
      </div>
      {actions && <div className={s.actions} onClick={(e) => e.stopPropagation()}>{actions}</div>}
      {!compact && meta && <div className={s.meta}>{meta}</div>}
      {!compact && status && <div className={cx(s.status, s[`s-${status.tone}`])}>{status.label}</div>}
    </div>
  )
}
