import type { CanvasView } from '@shared/types'

// Pan and zoom for a canvas whose plane is drawn at translate(x, y) scale(scale) from its top-left:
// a content point c sits on screen at c * scale + (x, y), all in viewport px (design D5).

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

export const DEFAULT_VIEW: CanvasView = { x: 0, y: 0, scale: 1 }
export const SCALE = { min: 0.1, max: 2 }
const STEP = 1.25    // one − or + click
const MARGIN = 64    // px of content that panning always leaves on screen

export const clampScale = (scale: number) => Math.min(SCALE.max, Math.max(SCALE.min, scale))

// Zoom by factor, keeping the content under point (viewport coords) where it is.
export function zoomAt(view: CanvasView, factor: number, point: Point): CanvasView {
  const scale = clampScale(view.scale * factor)
  const k = scale / view.scale
  return { x: point.x - (point.x - view.x) * k, y: point.y - (point.y - view.y) * k, scale }
}

// A wheel tick's zoom: exponential so many small trackpad deltas add up like one big mouse notch;
// a pinch (ctrlKey wheel) reports small deltas, so it is more sensitive.
export const wheelFactor = (deltaY: number, pinch: boolean) => Math.exp(-deltaY * (pinch ? 0.01 : 0.002))

export const panBy = (view: CanvasView, dx: number, dy: number): CanvasView => ({ ...view, x: view.x + dx, y: view.y + dy })

// Some of the content stays on screen however far it is dragged: at least MARGIN px of it, or all of it if smaller.
export function clampPan(view: CanvasView, viewport: Size, content: Size): CanvasView {
  const axis = (at: number, port: number, size: number) => {
    const keep = Math.min(MARGIN, size)
    return Math.min(port - keep, Math.max(keep - size, at))
  }
  return { ...view, x: axis(view.x, viewport.width, content.width * view.scale), y: axis(view.y, viewport.height, content.height * view.scale) }
}

// The whole content centred with pad px around it, never magnified past 100%.
export function fitView(viewport: Size, content: Size, pad: number): CanvasView {
  if (content.width <= 0 || content.height <= 0) return DEFAULT_VIEW
  const scale = clampScale(Math.min(1, (viewport.width - 2 * pad) / content.width, (viewport.height - 2 * pad) / content.height))
  return { x: (viewport.width - content.width * scale) / 2, y: (viewport.height - content.height * scale) / 2, scale }
}

// Zoom to scale around the viewport's centre (the percent button: back to 100%).
export const zoomTo = (view: CanvasView, scale: number, viewport: Size) =>
  zoomAt(view, scale / view.scale, { x: viewport.width / 2, y: viewport.height / 2 })

// The − and + buttons: one step out or in around the viewport's centre.
export const zoomStep = (view: CanvasView, dir: 1 | -1, viewport: Size) => zoomTo(view, view.scale * STEP ** dir, viewport)

// Saves a view behind the gesture: schedule debounces, flush writes the pending view now (once),
// cancel drops it. The view is persisted state, so it must not be written per wheel or pointer event.
export function viewWriter(write: (view: CanvasView) => void, delayMs: number) {
  let pending: CanvasView | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; pending = null }
  const flush = () => {
    const view = pending
    cancel()
    if (view) write(view)
  }
  const schedule = (view: CanvasView) => {
    if (timer) clearTimeout(timer)
    pending = view
    timer = setTimeout(flush, delayMs)
  }
  return { schedule, flush, cancel }
}
