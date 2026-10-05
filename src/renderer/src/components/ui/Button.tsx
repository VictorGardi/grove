import type { ButtonHTMLAttributes } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'
import s from './Button.module.css'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  icon?: IconName
  round?: boolean
}

export function Button({ variant = 'secondary', size = 'md', icon, round, className, children, ...rest }: Props) {
  return (
    <button type="button" {...rest} className={cx(s.button, s[variant], s[size], round && s.round, className)}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  )
}
