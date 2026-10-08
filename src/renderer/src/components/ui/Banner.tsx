import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'
import s from './Banner.module.css'

export function Banner({ tone = 'error', children }: { tone?: 'error' | 'info'; children: ReactNode }) {
  return (
    <div role="alert" className={cx(s.banner, s[tone])}>
      <Icon name="info" size={14} />
      <span>{children}</span>
    </div>
  )
}
