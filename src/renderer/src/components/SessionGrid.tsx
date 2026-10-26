import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { GridTracks, Session } from '@shared/types'
import { contextView } from '../contextGauge'
import {
  dividers, gridShape, hasArrangement, minTrackFraction, nextSpan, PANE_MIN_PX, paneSpans, paneTitle, placedSpan, placePanes,
  resizeTracks, shapeKey, trackFractions, visibleMembers, type Divider, type GridView,
} from '../gridView'
import { familyOf } from '../family'
import { useSlices } from '../stores/slices'
import { colorTags } from '../tags'
import { linkedFeature } from '../tree'
import { SessionMeta } from './SessionMeta'
import { Button } from './ui/Button'
import { cx } from './ui/cx'
import { ContextGauge } from './ContextGauge'
import { GridToolbar } from './GridToolbar'
import { TerminalView } from './TerminalView'
import s from './SessionGrid.module.css'

// The members side by side. Panes are keyed by session id, so reflow never remounts or re-attaches a terminal.
export function SessionGrid({ sessions, focusedId, view, onViewChange, onFocusPane, overlayOpen }: {
  sessions: Session[] // every member, in grid order; the view narrows them
  view: GridView
  onViewChange: (view: GridView) => void
  focusedId: string
  onFocusPane: (id: string) => void // a click or terminal focus inside a pane
  overlayOpen: boolean // a modal or the palette is open: no terminal takes the keyboard
}) {
  const { sessions: all, projects, features, ui, toggleGridMember, openAlone, clearGrid, swapGridPanes, setGridSpan, setGridTracks, resetGridArrangement } = useSlices()
  const visible = visibleMembers(sessions, view, projects)
  const root = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  // the dimming slider sets the unfocused panes' opacity for this grid only
  useEffect(() => { root.current?.style.setProperty('--pane-dim', String(view.dim)) }, [view.dim])
  const shape = gridShape(visible.length, view.layout)
  const key = shapeKey(shape)

  // Track sizes: the stored ones for this shape, with a draft laid over them while a divider is dragged
  // (layout follows live; the store is written on release).
  const [draft, setDraft] = useState<(GridTracks & { key: string }) | null>(null)
  const stored = ui.grid.tracks?.[key]
  const colFr = trackFractions((draft?.key === key ? draft.cols : undefined) ?? stored?.cols, shape.cols)
  const rowFr = trackFractions((draft?.key === key ? draft.rows : undefined) ?? stored?.rows, shape.rows)
  useEffect(() => {
    const tpl = (fr: number[]) => fr.map((f) => `minmax(0, ${f * 1000}fr)`).join(' ')
    root.current?.style.setProperty('--cols-tpl', tpl(colFr))
    root.current?.style.setProperty('--rows-tpl', tpl(rowFr))
  }, [colFr.join(), rowFr.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  // the draft has done its job once the store holds what it showed
  useEffect(() => {
    if (!draft) return
    const same = (a: number[] | undefined, b: number[], n: number) => !a || trackFractions(b, n).every((f, i) => Math.abs(f - a[i]) < 1e-9)
    if (draft.key !== key || (same(draft.cols, trackFractions(stored?.cols, shape.cols), shape.cols) && same(draft.rows, trackFractions(stored?.rows, shape.rows), shape.rows))) setDraft(null)
  }, [draft, stored, key, shape.cols, shape.rows])

  const ids = visible.map((x) => x.id)
  const places = placePanes(paneSpans(ids, ui.grid.spans, shape), shape)
  const lines = dividers(places, shape)

  const resize = useRef<{ d: Divider; origin: number; total: number; start: number[]; min: number } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null) // "axis:index" of the divider in hand
  const axisOf = (d: Divider) => (d.axis === 'col' ? 'cols' : 'rows') as 'cols' | 'rows'
  const startResize = (e: PointerEvent<HTMLDivElement>, d: Divider) => {
    if (e.button !== 0 || !grid.current) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const css = getComputedStyle(grid.current)
    // the resolved tracks are in px, so their sum is what the fractions share, gaps excluded
    const total = (d.axis === 'col' ? css.gridTemplateColumns : css.gridTemplateRows).split(' ').reduce((sum, px) => sum + (parseFloat(px) || 0), 0)
    const n = d.axis === 'col' ? shape.cols : shape.rows
    resize.current = { d, origin: d.axis === 'col' ? e.clientX : e.clientY, total, start: d.axis === 'col' ? colFr : rowFr, min: minTrackFraction(total, PANE_MIN_PX[d.axis], n) }
    setDragging(`${d.axis}:${d.index}`)
  }
  const moveResize = (e: PointerEvent<HTMLDivElement>) => {
    const r = resize.current
    if (!r || r.total <= 0) return
    const delta = ((r.d.axis === 'col' ? e.clientX : e.clientY) - r.origin) / r.total
    setDraft({ key, [axisOf(r.d)]: resizeTracks(r.start, r.d.index, delta, r.min) })
  }
  const endResize = (e: PointerEvent<HTMLDivElement>) => {
    const r = resize.current
    resize.current = null
    setDragging(null)
    if (!r) return
    const next = r.d.axis === 'col' ? colFr : rowFr
    if (e.type === 'pointercancel' || next === r.start || next.every((f, i) => f === r.start[i])) return setDraft(null)
    setGridTracks(shape, axisOf(r.d), next)
  }
  // the xterm fit is debounced in TerminalView, so a drag refits once when it settles, not on every move

  // Reordering: a header drag past a few px picks the pane up; the pane under the pointer is the drop target.
  const pick = useRef<{ id: string; x: number; y: number; held: boolean } | null>(null)
  const [held, setHeld] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  // the pane under the pointer, other than the one in hand
  const paneAt = (e: PointerEvent, from: string) => {
    const id = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-pane]')?.dataset.pane ?? null
    return id !== from ? id : null
  }
  const startPick = (e: PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    pick.current = { id, x: e.clientX, y: e.clientY, held: false }
  }
  const movePick = (e: PointerEvent<HTMLDivElement>) => {
    const p = pick.current
    if (!p) return
    if (!p.held) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return
      p.held = true
      e.currentTarget.setPointerCapture(e.pointerId)
      setHeld(p.id)
    }
    setOver(paneAt(e, p.id))
  }
  const endPick = (e: PointerEvent<HTMLDivElement>) => {
    const p = pick.current
    pick.current = null
    const target = p?.held && e.type === 'pointerup' ? paneAt(e, p.id) : null
    if (p && target) swapGridPanes(p.id, target)
    setHeld(null)
    setOver(null)
  }
  const tags = colorTags(projects, features.items)
  return (
    <div className={s.root} ref={root}>
      <GridToolbar members={sessions} projects={projects} view={view} visibleCount={visible.length} canReset={hasArrangement(ui.grid)} onChange={onViewChange} onReset={() => { setDraft(null); resetGridArrangement() }} onEmpty={clearGrid} />
      <div className={s.stage}>
      <div className={s.grid} ref={grid}>
        {visible.length === 0 && <div className={s.none}>No sessions match</div>}
        {visible.map((x, i) => {
          const focused = x.id === focusedId
          const focus = () => { if (!focused) onFocusPane(x.id) }
          const feature = linkedFeature(x, features.items)
          const context = contextView(x)
          const place = places[i]
          const span = ui.grid.spans?.[x.id] ?? placedSpan(place)
          return (
            <div key={x.id} data-pane={x.id} onMouseDownCapture={focus}
              className={cx(s.pane, focused ? s.focused : s.dim, held === x.id && s.held, over === x.id && s.target)}
              style={{ '--col-span': place.cols, '--row-span': place.rows } as CSSProperties}>
              <div className={cx(s.header, held === x.id && s.grabbing)} onPointerDown={(e) => startPick(e, x.id)} onPointerMove={movePick} onPointerUp={endPick} onPointerCancel={endPick}>
                <SessionMeta lead={<span className={s.title}>{paneTitle(projects.find((p) => p.id === x.projectId), x)}</span>}
                  session={x} feature={feature} tagIndex={feature ? tags.group(feature.projectId, feature.group ? feature.slug : feature.parent) : null}
                  context={context ? <ContextGauge view={context} /> : undefined}
                  family={{ active: familyOf(all, x.id).active, onJump: onFocusPane }}
                  actions={<>
                    <Button variant="ghost" size="sm" round icon={`span-${span}` as const} aria-label={`Span ${span}, change`} title={`Span: ${span} (click for ${nextSpan(span)})`} onClick={() => setGridSpan(x.id, nextSpan(span))} />
                    <Button variant="ghost" size="sm" round icon="maximize" aria-label="Open alone" title="Open alone" onClick={() => openAlone(x.id)} />
                    <Button variant="ghost" size="sm" round icon="x" aria-label="Remove from grid" title="Remove from grid" onClick={() => toggleGridMember(x.id)} />
                  </>} />
              </div>
              {x.lastStatus === 'running'
                ? <TerminalView sessionId={x.id} active={focused && !overlayOpen} onFocus={focus} />
                : (
                  <div className={s.ended}>
                    <div>Session ended</div>
                    <div className={s.endedActions}>
                      {x.kind !== 'terminal' && (
                        <Button variant="primary" size="sm" icon="resume" onClick={() => void window.api.invoke('session:resume', { id: x.id })}>Resume</Button>
                      )}
                      <Button size="sm" icon="trash" onClick={() => toggleGridMember(x.id)}>Remove</Button>
                    </div>
                  </div>
                )}
            </div>
          )
        })}
      </div>
      <div className={s.overlay}>
        {lines.map((d) => (
          <div key={`${d.axis}:${d.index}:${d.from}`} role="separator" aria-orientation={d.axis === 'col' ? 'vertical' : 'horizontal'}
            className={cx(s.divider, d.axis === 'col' ? s.vertical : s.horizontal, dragging === `${d.axis}:${d.index}` && s.active)}
            style={{ '--line': d.index + 1, '--from': d.from + 1, '--to': d.to + 1 } as CSSProperties}
            title="Drag to resize, double-click to reset"
            onPointerDown={(e) => startResize(e, d)} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize}
            onDoubleClick={() => { setDraft(null); setGridTracks(shape, axisOf(d), null) }} />
        ))}
      </div>
      </div>
    </div>
  )
}
