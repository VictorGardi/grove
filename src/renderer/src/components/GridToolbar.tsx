import { useEffect, useRef, useState } from 'react'
import type { Project, Session } from '@shared/types'
import { DIM_RANGE, LAYOUT_MAX, gridShape, layoutLabel, type GridLayout, type GridView } from '../gridView'
import { Button } from './ui/Button'
import { cx } from './ui/cx'
import s from './GridToolbar.module.css'

// The layout button: opens a popover with a grid of cells; hovering a cell previews cols×rows, clicking picks it.
function SizePicker({ view, visibleCount, onChange }: { view: GridView; visibleCount: number; onChange: (view: GridView) => void }) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<GridLayout | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  const current = gridShape(visibleCount, view.layout)
  const shown = hover ?? current
  const cells = Array.from({ length: LAYOUT_MAX * LAYOUT_MAX }, (_, i) => ({ col: (i % LAYOUT_MAX) + 1, row: Math.floor(i / LAYOUT_MAX) + 1 }))
  return (
    <div className={s.size} ref={ref}>
      <Button size="sm" icon="grid" aria-expanded={open} title="Grid layout" onClick={() => setOpen(!open)}>
        {layoutLabel(visibleCount, view.layout)}
      </Button>
      {open && (
        <div className={s.popover} role="menu" onMouseLeave={() => setHover(null)}>
          <div className={s.cells}>
            {cells.map(({ col, row }) => (
              <button key={`${col}-${row}`} type="button" aria-label={`${col}×${row}`}
                className={cx(s.cell, col <= shown.cols && row <= shown.rows && s.on)}
                onMouseEnter={() => setHover({ cols: col, rows: row })}
                onClick={() => { onChange({ ...view, layout: { cols: col, rows: row } }); setOpen(false) }} />
            ))}
          </div>
          <div className={s.shape}>{shown.cols}×{shown.rows}</div>
          <button type="button" className={cx(s.auto, view.layout === null && s.autoOn)}
            onClick={() => { onChange({ ...view, layout: null }); setOpen(false) }}>Auto</button>
        </div>
      )}
    </div>
  )
}

// Filter tabs, grid size, dimming slider, eye and Empty grid. View-only: nothing here is persisted.
export function GridToolbar({ members, projects, view, visibleCount, onChange, onEmpty }: {
  members: Session[]
  projects: Project[]
  view: GridView
  visibleCount: number
  onChange: (view: GridView) => void
  onEmpty: () => void
}) {
  const tabs = projects.flatMap((p) => {
    const count = members.filter((m) => m.projectId === p.id).length
    return count > 0 ? [{ id: p.id, name: p.name, count }] : []
  })
  const filter = tabs.some((t) => t.id === view.filter) ? view.filter : null // a stale filter reads as ALL
  const tab = (id: string | null, label: string, count: number) => (
    <button key={id ?? 'all'} type="button" className={cx(s.tab, filter === id && s.active)} aria-pressed={filter === id}
      onClick={() => onChange({ ...view, filter: id })}>
      {label} <span className={s.count}>{count}</span>
    </button>
  )
  return (
    <div className={s.toolbar}>
      <div className={s.tabs}>
        {tab(null, 'ALL', members.length)}
        {tabs.map((t) => tab(t.id, t.name, t.count))}
      </div>
      <span className={s.spacer} />
      <SizePicker view={view} visibleCount={visibleCount} onChange={onChange} />
      <Button variant="ghost" size="sm" round icon={view.hideEnded ? 'eye-off' : 'eye'} aria-pressed={view.hideEnded}
        aria-label={view.hideEnded ? 'Show ended sessions' : 'Hide ended sessions'}
        title={view.hideEnded ? 'Show ended sessions' : 'Hide ended sessions'}
        onClick={() => onChange({ ...view, hideEnded: !view.hideEnded })} />
      <input type="range" className={s.slider} min={DIM_RANGE.min} max={DIM_RANGE.max} step={0.05} value={view.dim}
        aria-label="Dim unfocused panes" title="How dimmed the unfocused panes are (left is darker)"
        onChange={(e) => onChange({ ...view, dim: Number(e.target.value) })} />
      <Button size="sm" onClick={onEmpty}>Empty grid</Button>
    </div>
  )
}
