import type { ReactNode } from 'react'
import { cx } from './cx'
import s from './Badge.module.css'

export function Badge({ tone = 'accent', children }: { tone?: 'accent' | 'muted'; children: ReactNode }) {
  return <span className={cx(s.badge, s[tone])}>{children}</span>
}
