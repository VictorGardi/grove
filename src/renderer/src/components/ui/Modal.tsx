import { useEffect, type ReactNode } from 'react'
import { cx } from './cx'
import s from './Modal.module.css'

interface Props {
  onClose: () => void
  onConfirm?: () => void
  width?: 'sm' | 'md' | 'lg'
  children: ReactNode
}

export function Modal({ onClose, onConfirm, width = 'md', children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = e.key === 'Escape' ? onClose : e.key === 'Enter' ? onConfirm : undefined
      if (!action) return
      // a textarea's ↵ is a newline, not a confirmation
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'TEXTAREA') return
      // A control that answers ↵ itself owns the key. This listener is on window in the capture
      // phase, so nothing below it can stop it — without this line, ↵ on the palette's trailing
      // sandbox switch would flip it *and* launch the highlighted row, and ↵ on the launch form's
      // own Cancel button would submit the form it is meant to dismiss.
      if (e.key === 'Enter' && (e.target as HTMLElement).closest('button, [role="switch"]')) return
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
