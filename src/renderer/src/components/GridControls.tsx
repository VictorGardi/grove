import { useEffect, useRef, useState } from 'react'
import { DIM_RANGE, LAYOUT_MAX, gridShape, layoutLabel, type GridLayout, type GridView } from '../gridView'
import { Button } from './ui/Button'
import { cx } from './ui/cx'
import s from './GridControls.module.css'

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

// Grid size, reset, eye, dimming slider and Empty grid, on the right of the content header while
// the grid shows. The settings are view-only; reset edits the persisted arrangement.
export function GridControls({ view, visibleCount, canReset, onChange, onReset, onEmpty }: {
  view: GridView
  visibleCount: number
  canReset: boolean // some pane has a span or some shape has resized tracks
  onChange: (view: GridView) => void
  onReset: () => void
  onEmpty: () => void
}) {
  return (
    <div className={s.controls}>
      <SizePicker view={view} visibleCount={visibleCount} onChange={onChange} />
      <Button variant="ghost" size="sm" round icon="resume" disabled={!canReset} aria-label="Reset pane sizes and spans"
        title="Reset pane sizes and spans" onClick={onReset} />
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
