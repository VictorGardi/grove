import type { CanvasView } from '@shared/types'
import type { Size } from './canvasView'

// Which board cards mount a live preview (design D2): only while zoomed in far enough to read one,
// only near the viewport, and never more than a handful of iframes at once.
export const PREVIEW = {
  minScale: 0.4, // below this a card is under ~100 screen px wide: a title card reads better
  margin: 400,   // screen px around the viewport mounted ahead of a pan
  maxLive: 24,   // enough that a typical window at 100 % is fully live
}

export interface Rect { x: number; y: number; width: number; height: number } // plane coordinates

export const screenRect = (r: Rect, view: CanvasView): Rect =>
  ({ x: r.x * view.scale + view.x, y: r.y * view.scale + view.y, width: r.width * view.scale, height: r.height * view.scale })

// The keys to mount, at most PREVIEW.maxLive of them: cards on screen before cards only in the margin,
// then nearest the viewport's centre first.
export function livePreviews(rects: Map<string, Rect>, view: CanvasView, viewport: Size): Set<string> {
  if (view.scale < PREVIEW.minScale || viewport.width <= 0 || viewport.height <= 0) return new Set()
  const m = PREVIEW.margin
  const cx = viewport.width / 2
  const cy = viewport.height / 2
  const outside = (r: Rect, pad: number) =>
    r.x + r.width < -pad || r.x > viewport.width + pad || r.y + r.height < -pad || r.y > viewport.height + pad
  const near: { key: string; margin: number; d: number }[] = []
  for (const [key, rect] of rects) {
    const r = screenRect(rect, view)
    if (outside(r, m)) continue
    near.push({ key, margin: outside(r, 0) ? 1 : 0, d: Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy) })
  }
  near.sort((a, b) => a.margin - b.margin || a.d - b.d)
  return new Set(near.slice(0, PREVIEW.maxLive).map((n) => n.key))
}

export const sameSet = <T>(a: Set<T>, b: Set<T>) => a.size === b.size && [...a].every((k) => b.has(k))
