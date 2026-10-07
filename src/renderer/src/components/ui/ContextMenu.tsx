import { useEffect, useRef } from 'react'
import { Icon, type IconName } from './Icon'
import s from './ContextMenu.module.css'

export interface MenuEntry {
  label: string
  icon?: IconName
  danger?: boolean
  onSelect: () => void
}

// A right-click menu at a point; closes on a pick, an outside click, Escape or scroll.
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = root.current
    if (!el) return
    // keep it inside the window
    const { width, height } = el.getBoundingClientRect()
    el.style.setProperty('--x', `${Math.max(0, Math.min(x, window.innerWidth - width - 4))}px`)
    el.style.setProperty('--y', `${Math.max(0, Math.min(y, window.innerHeight - height - 4))}px`)
  }, [x, y])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true) // capture, so a focused terminal doesn't see it
    window.addEventListener('blur', onClose)
    window.addEventListener('wheel', onClose, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('wheel', onClose, true)
    }
  }, [onClose])
  return (
    <div className={s.backdrop} onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div ref={root} role="menu" className={s.menu} onMouseDown={(e) => e.stopPropagation()}>
        {items.map((it) => (
          <button key={it.label} type="button" role="menuitem" className={it.danger ? s.danger : s.item}
            onClick={() => { onClose(); it.onSelect() }}>
            {it.icon && <Icon name={it.icon} size={13} />}
            {it.label}
          </button>
        ))}
      </div>
    </div>
  )
}
