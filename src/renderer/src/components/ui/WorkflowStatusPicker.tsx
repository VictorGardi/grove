import { useEffect, useRef, useState } from 'react'
import type { WorkflowStatus } from '@shared/types'
import { WORKFLOW_STATUSES, workflowStatusOf, type WorkflowStatusView } from '../../workflowStatus'
import { cx } from './cx'
import s from './WorkflowStatusPicker.module.css'

// The glyph a status draws, as a ring like the live-status circle it replaces.
export function Glyph({ view, size = 14, className }: { view: WorkflowStatusView; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cx(s.glyph, className)}>
      {view.glyph === 'dashed' && <circle cx="10" cy="10" r="7" strokeDasharray="2.6 2.4" />}
      {view.glyph === 'partial' && (
        <>
          <circle cx="10" cy="10" r="7" />
          <circle cx="10" cy="10" r="3.9" fill="currentColor" stroke="none" strokeWidth={6}
            strokeDasharray={`${2 * Math.PI * 3.9 * 0.3} ${2 * Math.PI * 3.9}`} transform="rotate(-90 10 10)" />
        </>
      )}
      {view.glyph === 'clock' && (
        <>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 6v4l2.6 1.6" />
        </>
      )}
      {view.glyph === 'cross' && (
        <>
          <circle cx="10" cy="10" r="7" />
          <path d="m7.4 7.4 5.2 5.2M12.6 7.4l-5.2 5.2" />
        </>
      )}
      {view.glyph === 'check' && (
        <>
          <circle cx="10" cy="10" r="7" fill="currentColor" stroke="none" />
          <path d="m6.6 10.2 2.4 2.4 4.6-5" stroke="var(--panel-bg)" strokeWidth={2} />
        </>
      )}
      {view.glyph === 'pin' && (
        <>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 4.6 12.5 8.6h-5L10 4.6Z" fill="currentColor" stroke="none" />
          <path d="M10 8.6v6.2" />
        </>
      )}
    </svg>
  )
}

// The card's top-left icon: the session's manual workflow status, and the way to change it.
// Owns its menu, so a caller only hands over a session id.
export function WorkflowStatusButton({ session, size = 14 }: { session: { id: string; workflowStatus: WorkflowStatus }; size?: number }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const current = workflowStatusOf(session.workflowStatus)
  const open = at !== null

  // keep the menu on screen: flip above the button near the bottom, clamp the left edge
  useEffect(() => {
    if (!at || !menuRef.current) return
    const el = menuRef.current
    const { width, height } = el.getBoundingClientRect()
    const button = root.current?.getBoundingClientRect()
    if (!button) return
    el.style.setProperty('--x', `${Math.max(4, Math.min(button.left, window.innerWidth - width - 4))}px`)
    el.style.setProperty('--y', `${button.bottom + height > window.innerHeight - 4 ? Math.max(4, button.top - height) : button.bottom + 4}px`)
  }, [at])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setAt(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setAt(null) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function pick(value: WorkflowStatus) {
    setAt(null)
    await window.api.invoke('session:workflowStatus', { id: session.id, status: value })
  }

  return (
    <div ref={root} className={s.root} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      <button type="button" className={cx(s.button, s[current.tone])} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Status: ${current.label}`} title={`Status: ${current.label}`}
        onClick={(e) => { e.stopPropagation(); setAt({ x: e.clientX, y: e.clientY }) }}>
        <Glyph view={current} size={size} />
      </button>
      {open && (
        <div ref={menuRef} className={s.menu} role="menu" aria-label="Workflow status">
          {WORKFLOW_STATUSES.map((v) => (
            <button key={v.value} type="button" role="menuitemradio" aria-checked={v.value === current.value}
              className={cx(s.item, s[v.tone])} onClick={() => void pick(v.value)}>
              <Glyph view={v} size={13} />
              <span>{v.label}</span>
              {v.value === current.value && <span className={s.check}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}