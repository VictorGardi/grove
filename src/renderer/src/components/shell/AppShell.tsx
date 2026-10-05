import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { cx } from '../ui/cx'
import s from './AppShell.module.css'

const MIN = 320 // px, for both the viewer and the content beside it

export function AppShell({ topBar, banners, sidebar, content, viewer, sidebarWidth, viewerWidth, viewerExpanded, onViewerWidth }: {
  topBar: ReactNode
  banners?: ReactNode
  sidebar: ReactNode
  content: ReactNode
  viewer?: ReactNode
  sidebarWidth: number
  viewerWidth: number
  viewerExpanded: boolean
  onViewerWidth: (px: number) => void
}) {
  const mainRef = useRef<HTMLElement>(null)
  const viewerRef = useRef<HTMLElement>(null)
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

  return (
    <div className={s.shell} style={{ '--sidebar-w': `${sidebarWidth}px`, '--viewer-w': `${drag ?? viewerWidth}px` } as CSSProperties}>
      {topBar}
      {banners}
      <div className={cx(s.body, !!viewer && viewerExpanded && s.expanded)}>
        <aside className={s.sidebar}>{sidebar}</aside>
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
