import { useEffect, type ReactNode } from 'react'
import { cx } from './cx'
import s from './Modal.module.css'

interface Props {
  onClose: () => void
  onConfirm?: () => void
  width?: 'sm' | 'md'
  children: ReactNode
}

export function Modal({ onClose, onConfirm, width = 'md', children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = e.key === 'Escape' ? onClose : e.key === 'Enter' ? onConfirm : undefined
      if (!action) return
      e.preventDefault()
      e.stopPropagation()
      action()
    }
    // capture, so the keys don't also reach a focused terminal
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, onConfirm])

  return (
    <div className={s.backdrop} onClick={onClose}>
      <div role="dialog" aria-modal="true" className={cx(s.panel, s[width])} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
