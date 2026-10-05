import type { ReactNode } from 'react'
import { cx } from './cx'
import { StatusDot, type StatusTone } from './StatusDot'
import s from './ListRow.module.css'

interface Props {
  title: string
  icon?: ReactNode
  meta?: ReactNode
  status?: { label: string; tone: StatusTone }
  tone?: 'default' | 'selected' | 'waiting' | 'finished' | 'muted'
  compact?: boolean
  actions?: ReactNode
  onClick?: () => void
  onTitleDoubleClick?: () => void
  editor?: ReactNode // replaces the title while renaming
}

export function ListRow({ title, icon, meta, status, tone = 'default', compact, actions, onClick, onTitleDoubleClick, editor }: Props) {
  return (
    <div className={cx(s.row, s[tone], compact && s.compact)} onClick={onClick}>
      <div className={s.head}>
        {icon}
        {editor ?? <span className={s.title} onDoubleClick={onTitleDoubleClick}>{title}</span>}
        {compact && status && <StatusDot tone={status.tone} />}
        {actions && <div className={s.actions} onClick={(e) => e.stopPropagation()}>{actions}</div>}
      </div>
      {!compact && meta && <div className={s.meta}>{meta}</div>}
      {!compact && status && <div className={cx(s.status, s[`s-${status.tone}`])}>{status.label}</div>}
    </div>
  )
}
