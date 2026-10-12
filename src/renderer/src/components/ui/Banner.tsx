import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'
import s from './Banner.module.css'

export function Banner({ tone = 'error', onDismiss, children }: {
  tone?: 'error' | 'info'
  // Offered by the one banner the human raised: the others are the app reporting on itself, and a
  // dismiss on those would offer to hide the reason a session could not start.
  onDismiss?: () => void
  children: ReactNode
}) {
  return (
    <div role="alert" className={cx(s.banner, s[tone])}>
      <Icon name="info" size={14} />
      <span>{children}</span>
      {onDismiss && (
        <button type="button" className={s.dismiss} aria-label="Dismiss" onClick={onDismiss}>
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  )
}
