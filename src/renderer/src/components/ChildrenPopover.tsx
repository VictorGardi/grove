import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { Session } from '@shared/types'
import { childrenCount, isEnded } from '../family'
import { statusTone, statusView } from '../sessionStatus'
import { StatusDot } from './ui/StatusDot'
import s from './ChildrenPopover.module.css'

// A parent's "N children" chip: clicking lists every child (running first, by rank; ended ones
// last), and clicking one focuses it. Rows are buttons, so the grid's drag handler leaves them
// alone even though portal events bubble through the pane.
export function ChildrenPopover({ kids, onJump }: { kids: Session[]; onJump: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ top: 0, left: 0 })
  // the list sizes to its longest label, so keep it on-screen once its width is known
  useLayoutEffect(() => {
    const w = popRef.current?.offsetWidth
    if (!open || !w) return
    const left = Math.max(8, Math.min(at.left, window.innerWidth - w - 8))
    if (left !== at.left) setAt({ ...at, left })
  }, [open, at])
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false)
    }
    // capture phase, and swallowed: a focused terminal would otherwise take the Escape for the agent
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation(); e.preventDefault(); setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true) }
  }, [open])
  return (
    <div className={s.wrap} ref={ref}>
      <button type="button" className={s.trigger} aria-expanded={open} aria-haspopup="dialog" title="Show all children" onClick={() => {
        const r = ref.current?.getBoundingClientRect()
        if (r) setAt({ top: r.bottom + 8, left: Math.max(8, r.left) })
        setOpen(!open)
      }}>
        {childrenCount(kids.length)}
      </button>
      {open && createPortal(
        <div ref={popRef} className={s.popover} style={{ '--top': `${at.top}px`, '--left': `${at.left}px` } as CSSProperties} role="dialog" aria-label="Children">
          {kids.map((c) => (
            <button key={c.id} type="button" className={s.item} title={`${c.label} · ${statusView(c).label}`}
              onClick={() => { onJump(c.id); setOpen(false) }}>
              <StatusDot tone={statusTone(c)} />
              <span className={s.label}>{c.label}</span>
              {isEnded(c) && <span className={s.ended}>ended</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
