import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VIEW, SCALE, clampPan, clampScale, fitView, panBy, viewWriter, wheelFactor, zoomAt, zoomStep, zoomTo } from './canvasView'

const port = { width: 800, height: 600 }
// The content point drawn at a viewport point.
const contentAt = (v: { x: number; y: number; scale: number }, p: { x: number; y: number }) => ({ x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale })

describe('zoomAt', () => {
  it('keeps the content under the cursor fixed', () => {
    const v = { x: 30, y: -40, scale: 0.8 }
    const p = { x: 250, y: 170 }
    const z = zoomAt(v, 1.5, p)
    expect(z.scale).toBeCloseTo(1.2)
    expect(contentAt(z, p).x).toBeCloseTo(contentAt(v, p).x)
    expect(contentAt(z, p).y).toBeCloseTo(contentAt(v, p).y)
  })

  it('stops at the scale bounds, still around the cursor', () => {
    const p = { x: 100, y: 100 }
    const out = zoomAt(DEFAULT_VIEW, 0.001, p)
    expect(out.scale).toBe(SCALE.min)
    expect(contentAt(out, p).x).toBeCloseTo(100)
    expect(zoomAt(DEFAULT_VIEW, 100, p).scale).toBe(SCALE.max)
  })
})

describe('clampScale, wheelFactor', () => {
  it('clamps to the bounds', () => {
    expect([0, 0.5, 9].map(clampScale)).toEqual([SCALE.min, 0.5, SCALE.max])
  })

  it('zooms in on a wheel up, out on a wheel down, a pinch more per delta', () => {
    expect(wheelFactor(-100, false)).toBeGreaterThan(1)
    expect(wheelFactor(100, false)).toBeLessThan(1)
    expect(wheelFactor(0, true)).toBe(1)
    expect(wheelFactor(-10, true)).toBeGreaterThan(wheelFactor(-10, false))
    expect(wheelFactor(50, false) * wheelFactor(50, false)).toBeCloseTo(wheelFactor(100, false))
  })
})

describe('panBy, clampPan', () => {
  it('moves the view by the drag', () => {
    expect(panBy({ x: 10, y: 20, scale: 0.5 }, 5, -30)).toEqual({ x: 15, y: -10, scale: 0.5 })
  })

  it('leaves part of the content on screen however far it is dragged', () => {
    const content = { width: 1000, height: 2000 }
    expect(clampPan({ x: 5000, y: 5000, scale: 1 }, port, content)).toEqual({ x: 800 - 64, y: 600 - 64, scale: 1 })
    expect(clampPan({ x: -5000, y: -5000, scale: 0.5 }, port, content)).toEqual({ x: 64 - 500, y: 64 - 1000, scale: 0.5 })
    expect(clampPan({ x: 10, y: -20, scale: 1 }, port, content)).toEqual({ x: 10, y: -20, scale: 1 })
  })

  it('keeps all of a content smaller than the margin', () => {
    expect(clampPan({ x: -100, y: 900, scale: 1 }, port, { width: 40, height: 40 })).toEqual({ x: 0, y: 560, scale: 1 })
  })
})

describe('fitView', () => {
  it('shrinks a large content to fit, centred', () => {
    const v = fitView(port, { width: 1520, height: 580 }, 20)
    expect(v.scale).toBeCloseTo(0.5)
    expect(v.x).toBeCloseTo(20)
    expect(v.y).toBeCloseTo((600 - 290) / 2)
  })

  it('never magnifies a small content, and centres it', () => {
    expect(fitView(port, { width: 200, height: 100 }, 20)).toEqual({ x: 300, y: 250, scale: 1 })
  })

  it('falls back to the default view with nothing to fit', () => {
    expect(fitView(port, { width: 0, height: 0 }, 20)).toEqual(DEFAULT_VIEW)
  })
})

describe('zoomStep', () => {
  it('steps in and out around the viewport centre', () => {
    const centre = { x: 400, y: 300 }
    const v = { x: 10, y: 10, scale: 1 }
    const zin = zoomStep(v, 1, port)
    expect(zin.scale).toBeCloseTo(1.25)
    expect(contentAt(zin, centre).x).toBeCloseTo(contentAt(v, centre).x)
    expect(zoomStep(zin, -1, port).scale).toBeCloseTo(1)
  })
})

describe('zoomTo', () => {
  it('zooms to a scale around the viewport centre', () => {
    const centre = { x: 400, y: 300 }
    const v = { x: -120, y: 45, scale: 0.4 }
    const z = zoomTo(v, 1, port)
    expect(z.scale).toBe(1)
    expect(contentAt(z, centre).x).toBeCloseTo(contentAt(v, centre).x)
    expect(contentAt(z, centre).y).toBeCloseTo(contentAt(v, centre).y)
    expect(zoomTo(v, 0.4, port)).toEqual(v)
  })
})

describe('viewWriter', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const a = { x: 1, y: 1, scale: 1 }
  const b = { x: 2, y: 2, scale: 1 }

  it('coalesces a burst into one write of the last view, after the delay', () => {
    const write = vi.fn()
    const w = viewWriter(write, 300)
    w.schedule(a)
    vi.advanceTimersByTime(200)
    w.schedule(b)
    vi.advanceTimersByTime(299)
    expect(write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(write.mock.calls).toEqual([[b]])
  })

  it('flushes the pending view at once, and only once', () => {
    const write = vi.fn()
    const w = viewWriter(write, 300)
    w.schedule(a)
    w.flush()
    w.flush()
    vi.advanceTimersByTime(1000)
    expect(write.mock.calls).toEqual([[a]])
  })

  it('writes nothing on a flush with nothing pending, or after a cancel', () => {
    const write = vi.fn()
    const w = viewWriter(write, 300)
    w.flush()
    w.schedule(a)
    w.cancel()
    w.flush()
    vi.advanceTimersByTime(1000)
    expect(write).not.toHaveBeenCalled()
  })
})
