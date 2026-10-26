import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import type { CanvasView } from '@shared/types'
import type { ArtifactCard, ArtifactCluster } from '../artifactsBoard'
import { DEFAULT_VIEW, clampPan, fitView, panBy, viewWriter, wheelFactor, zoomAt, zoomStep, zoomTo, type Size } from '../canvasView'
import { livePreviews, sameSet, type Rect } from '../previewGate'
import { ArtifactCard as CardView } from './ArtifactCard'
import { Button } from './ui/Button'
import { cx } from './ui/cx'
import s from './ArtifactsBoard.module.css'

const DRAG_PX = 4        // a press that moves less than this is a click
const SAVE_DELAY_MS = 300
const FIT_PAD = 32
const CLOCK_MS = 60_000 // how often the cards' "5m ago" moves on

interface Props {
  clusters: ArtifactCluster[]
  stages: { id: string; label: string }[]
  view: CanvasView | undefined // the saved pan and zoom; absent: the default view
  onViewChange(view: CanvasView): void
  onOpen(cluster: ArtifactCluster, card: ArtifactCard): void
}

// A repo's artifacts on a whiteboard: one labelled cluster per feature in the features board's order,
// a live preview card per file (design D2). Drag pans, wheel and pinch zoom around the cursor (design D5).
export function ArtifactsBoard(props: Props) {
  if (props.clusters.length === 0) return <div className={s.empty}>No artifacts yet</div>
  return <Canvas {...props} />
}

// one key per card, for React and the preview gate alike; paths are project-relative
const cardKey = (c: ArtifactCluster, card: ArtifactCard) => c.feature.projectId + '/' + card.path
const clusterKey = (c: ArtifactCluster) => c.feature.projectId + '/' + c.feature.slug

function Canvas({ clusters, stages, view: saved, onViewChange, onOpen }: Props) {
  // live in component state while the gesture runs, saved behind it (design D1); the prop only seeds it
  const [view, setView] = useState(saved ?? DEFAULT_VIEW)
  const [panning, setPanning] = useState(false)
  const viewRef = useRef(view)
  const viewport = useRef<HTMLDivElement>(null)
  const plane = useRef<HTMLDivElement>(null)
  const change = useRef(onViewChange)
  change.current = onViewChange
  const opener = useRef(onOpen)
  opener.current = onOpen
  const [writer] = useState(() => viewWriter((v) => change.current(v), SAVE_DELAY_MS))
  const press = useRef<{ id: number; x: number; y: number; from: CanvasView; dragging: boolean } | null>(null)
  const dragged = useRef(false) // the click ending a drag must not open a card
  // cards' plane rects, measured after layout; until then no preview mounts (and none renders on the server)
  const rects = useRef(new Map<string, Rect>())
  const cards = useRef(new Map<string, HTMLElement>())
  const [live, setLive] = useState<Set<string>>(() => new Set())
  // what each card key opens, read through a ref so the stable onOpen below always finds today's card
  const index = useMemo(() => new Map(clusters.flatMap((c) => c.cards.map((card) => [cardKey(c, card), { cluster: c, card }] as const))), [clusters])
  const byKey = useRef(index)
  byKey.current = index
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => clearInterval(id)
  }, [])

  const sizes = (): { port: Size; content: Size } => ({
    port: { width: viewport.current?.clientWidth ?? 0, height: viewport.current?.clientHeight ?? 0 },
    // offset sizes ignore the transform: the plane's own, unscaled size
    content: { width: plane.current?.offsetWidth ?? 0, height: plane.current?.offsetHeight ?? 0 },
  })
  // mount the previews this view shows; a new set only when it differs, and the cards are memoised,
  // so a pan re-renders only the cards whose preview mounts or unmounts
  const gate = (v: CanvasView, port: Size) => {
    const next = livePreviews(rects.current, v, port)
    setLive((prev) => sameSet(prev, next) ? prev : next)
  }
  const show = (next: CanvasView) => {
    const { port, content } = sizes()
    const v = clampPan(next, port, content)
    viewRef.current = v
    setView(v)
    gate(v, port)
    return v
  }
  const commit = (next: CanvasView) => { writer.schedule(show(next)); writer.flush() }

  useEffect(() => () => writer.flush(), [writer])

  // a restored view may be off-screen at today's sizes: pull it back once, in local state only (the next gesture saves it)
  useLayoutEffect(() => {
    const { port, content } = sizes()
    if (!port.width || !port.height || !content.width || !content.height) return
    const v = clampPan(viewRef.current, port, content)
    if (v.x === viewRef.current.x && v.y === viewRef.current.y) return
    viewRef.current = v
    setView(v)
  }, [])

  // where each card sits on the plane; offsets ignore the transform, so these are plane coordinates
  useLayoutEffect(() => {
    const measure = () => {
      const root = plane.current
      if (!root) return
      const next = new Map<string, Rect>()
      for (const [key, el] of cards.current) {
        let x = 0
        let y = 0
        for (let at: HTMLElement | null = el; at && at !== root; at = at.offsetParent as HTMLElement | null) { x += at.offsetLeft; y += at.offsetTop }
        next.set(key, { x, y, width: el.offsetWidth, height: el.offsetHeight })
      }
      rects.current = next
      gate(viewRef.current, sizes().port)
    }
    measure()
    const el = viewport.current
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    if (plane.current) observer.observe(plane.current) // reflow inside the plane moves the cards
    return () => observer.disconnect()
  }, [clusters])

  // native and non-passive: React's wheel listener is passive, and the page must not scroll or zoom
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      writer.schedule(show(zoomAt(viewRef.current, wheelFactor(e.deltaY, e.ctrlKey), { x: e.clientX - r.left, y: e.clientY - r.top })))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, []) // attached once: show and the view read refs

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    dragged.current = false
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: viewRef.current, dragging: false }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    if (e.buttons === 0) { // released where we did not hear it (e.g. over the zoom controls)
      press.current = null
      setPanning(false)
      return
    }
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (!p.dragging) {
      if (Math.hypot(dx, dy) < DRAG_PX) return
      p.dragging = true
      setPanning(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    show(panBy(p.from, dx, dy))
  }
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    press.current = null
    if (!p.dragging) return
    dragged.current = true
    setPanning(false)
    commit(viewRef.current)
  }
  const onClickCapture = (e: MouseEvent) => {
    if (!dragged.current) return
    dragged.current = false
    e.stopPropagation()
    e.preventDefault()
  }

  const step = (dir: 1 | -1) => commit(zoomStep(viewRef.current, dir, sizes().port))
  const actualSize = () => commit(zoomTo(viewRef.current, 1, sizes().port))
  const fit = () => { const { port, content } = sizes(); commit(fitView(port, content, FIT_PAD)) }
  // stable, so the memoised cards skip a re-render when only the view changes
  const open = useCallback((key: string) => {
    const hit = byKey.current.get(key)
    if (!hit) return
    writer.flush()
    opener.current(hit.cluster, hit.card)
  }, [writer])
  const register = useCallback((key: string, el: HTMLElement | null) => {
    if (el) cards.current.set(key, el)
    else cards.current.delete(key)
  }, [])

  const label = (stage: string | null) => stages.find((st) => st.id === stage)?.label ?? 'Other'
  return (
    <div className={s.board}>
      <div ref={viewport} className={cx(s.viewport, panning && s.panning)} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onClickCapture={onClickCapture}>
        <div ref={plane} className={s.plane}
          style={{ '--x': `${view.x}px`, '--y': `${view.y}px`, '--scale': view.scale } as CSSProperties}>
          {clusters.map((c) => (
            <section key={clusterKey(c)} className={s.cluster}>
              <h2 className={s.heading}>{c.feature.title} <span className={s.count}>{c.cards.length}</span></h2>
              <div className={s.cards}>
                {c.cards.map((card) => {
                  const key = cardKey(c, card)
                  return <CardView key={key} id={key} projectId={c.feature.projectId} card={card} stage={label(card.stage)}
                    live={live.has(key)} now={now} onOpen={open} register={register} />
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
      <div className={s.controls}>
        <Button variant="ghost" size="sm" aria-label="Zoom out" onClick={() => step(-1)}>−</Button>
        <Button variant="ghost" size="sm" aria-label="Zoom to 100%" className={s.percent} onClick={actualSize}>{Math.round(view.scale * 100)}%</Button>
        <Button variant="ghost" size="sm" aria-label="Zoom in" onClick={() => step(1)}>+</Button>
        <Button variant="ghost" size="sm" onClick={fit}>Fit</Button>
      </div>
    </div>
  )
}
