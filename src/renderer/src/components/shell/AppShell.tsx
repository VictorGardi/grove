import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { cx } from '../ui/cx'
import s from './AppShell.module.css'

const MIN = 320 // px, for both the viewer and the content beside it
export const SIDEBAR_MIN = 220
export const SIDEBAR_MAX = 520

export function AppShell({ banners, sidebar, content, viewer, sidebarWidth, onSidebarWidth, viewerWidth, viewerExpanded, onViewerWidth }: {
  banners?: ReactNode
  sidebar: ReactNode
  content: ReactNode
  viewer?: ReactNode
  sidebarWidth: number
  onSidebarWidth?: (px: number | null) => void // absent while the sidebar is collapsed to its rail; null resets
  viewerWidth: number | null
  viewerExpanded: boolean
  onViewerWidth: (px: number) => void
}) {
  const mainRef = useRef<HTMLElement>(null)
  const viewerRef = useRef<HTMLElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const limit = useRef<{ right: number; total: number } | null>(null)
  // local while dragging; committed to ui state on release
  const [drag, setDrag] = useState<number | null>(null)

  const start = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const main = mainRef.current!.getBoundingClientRect()
    const panel = viewerRef.current!.getBoundingClientRect()
    limit.current = { right: panel.right, total: main.width + panel.width }
    setDrag(panel.width)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (limit.current) setDrag(Math.min(Math.max(limit.current.right - e.clientX, MIN), limit.current.total - MIN))
  }
  const end = () => {
    if (limit.current && drag !== null) onViewerWidth(drag)
    limit.current = null
    setDrag(null)
  }
  // same pattern for the sidebar: local while dragging, committed on release
  const [sideDrag, setSideDrag] = useState<number | null>(null)
  const sideStart = useRef<{ left: number } | null>(null)
  const sideDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    sideStart.current = { left: sidebarRef.current!.getBoundingClientRect().left }
    setSideDrag(sidebarWidth)
  }
  const sideMove = (e: PointerEvent<HTMLDivElement>) => {
    if (sideStart.current) setSideDrag(Math.min(Math.max(e.clientX - sideStart.current.left, SIDEBAR_MIN), SIDEBAR_MAX))
  }
  const sideUp = () => {
    if (sideStart.current && sideDrag !== null) onSidebarWidth?.(sideDrag)
    sideStart.current = null
    setSideDrag(null)
  }
  const viewerWidthValue = drag !== null ? `${drag}px` : viewerWidth === null ? '33vw' : `${viewerWidth}px`

  return (
    <div className={s.shell} style={{ '--sidebar-w': `${sideDrag ?? sidebarWidth}px`, '--viewer-w': viewerWidthValue } as CSSProperties}>
      {banners}
      <div className={cx(s.body, !!viewer && viewerExpanded && s.expanded)}>
        <aside ref={sidebarRef} className={cx(s.sidebar, sideDrag !== null && s.sidebarDragging)}>{sidebar}</aside>
        {onSidebarWidth && (
          <div className={s.splitter} role="separator" aria-orientation="vertical" aria-label="Resize sidebar"
            onPointerDown={sideDown} onPointerMove={sideMove} onPointerUp={sideUp} onPointerCancel={sideUp}
            onDoubleClick={() => onSidebarWidth(null)} />
        )}
        <main ref={mainRef} className={s.content}>{content}</main>
        {viewer && (
          <div className={s.splitter} role="separator" aria-orientation="vertical" aria-label="Resize viewer"
            onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
        )}
        {viewer && <aside ref={viewerRef} className={s.viewer}>{viewer}</aside>}
      </div>
    </div>
  )
}
