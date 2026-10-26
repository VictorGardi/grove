import { describe, expect, it } from 'vitest'
import { PREVIEW, livePreviews, sameSet, screenRect, type Rect } from './previewGate'

const port = { width: 800, height: 600 }
const at = (x: number, y: number): Rect => ({ x, y, width: 200, height: 150 })
const view = (x: number, y: number, scale = 1) => ({ x, y, scale })
const keys = (s: Set<string>) => [...s].sort()

describe('screenRect', () => {
  it('scales from the plane origin, then translates', () => {
    expect(screenRect(at(100, 50), view(10, -20, 0.5))).toEqual({ x: 60, y: 5, width: 100, height: 75 })
  })
})

describe('livePreviews', () => {
  const rects = new Map([['in', at(100, 100)], ['far', at(5000, 100)]])

  it('mounts cards in range and leaves far-off ones as title cards', () => {
    expect(keys(livePreviews(rects, view(0, 0), port))).toEqual(['in'])
  })

  it('counts the margin around the viewport as in range, and nothing past it', () => {
    const edge = PREVIEW.margin + port.width
    const list = new Map([['inside', at(edge - 1, 0)], ['outside', at(edge + 1, 0)], ['left', at(-PREVIEW.margin - 200, 0)]])
    expect(keys(livePreviews(list, view(0, 0), port))).toEqual(['inside', 'left'])
  })

  it('mounts none below the minimum zoom', () => {
    expect(livePreviews(rects, view(0, 0, PREVIEW.minScale - 0.01), port).size).toBe(0)
    expect(keys(livePreviews(rects, view(0, 0, PREVIEW.minScale), port))).toEqual(['in'])
  })

  it('caps the live set, keeping the cards nearest the centre', () => {
    const grid = new Map<string, Rect>()
    for (let i = 0; i < 60; i++) grid.set(String(i), { x: (i % 10) * 80, y: Math.floor(i / 10) * 100, width: 40, height: 40 })
    const live = livePreviews(grid, view(0, 0), port)
    expect(live.size).toBe(PREVIEW.maxLive)
    const d = (k: string) => { const r = grid.get(k)!; return Math.hypot(r.x + 20 - 400, r.y + 20 - 300) }
    const worstIn = Math.max(...[...live].map(d))
    const bestOut = Math.min(...[...grid.keys()].filter((k) => !live.has(k)).map(d))
    expect(worstIn).toBeLessThanOrEqual(bestOut)
  })

  it('fills slots with on-screen cards before cards only in the margin', () => {
    // a wide card just above the top edge sits nearer the viewport's centre than cards in the far corner
    const list = new Map<string, Rect>([['margin', { x: 0, y: -30, width: port.width, height: 20 }]])
    for (let i = 0; i < PREVIEW.maxLive; i++) list.set(`on${i}`, { x: port.width - 10, y: port.height - 10, width: 5, height: 5 })
    const margin = screenRect(list.get('margin')!, view(0, 0))
    const corner = screenRect(list.get(`on${PREVIEW.maxLive - 1}`)!, view(0, 0))
    const d = (r: Rect) => Math.hypot(r.x + r.width / 2 - 400, r.y + r.height / 2 - 300)
    expect(d(margin)).toBeLessThan(d(corner)) // by distance alone the margin card would win a slot
    const live = livePreviews(list, view(0, 0), port)
    expect(live.size).toBe(PREVIEW.maxLive)
    expect(live.has('margin')).toBe(false)
  })

  it('follows a pan', () => {
    expect(keys(livePreviews(rects, view(-4900, 0), port))).toEqual(['far'])
  })

  it('mounts none in an empty or unmeasured viewport', () => {
    expect(livePreviews(new Map(), view(0, 0), port).size).toBe(0)
    expect(livePreviews(rects, view(0, 0), { width: 0, height: 0 }).size).toBe(0)
  })
})

describe('sameSet', () => {
  it('compares members, not order', () => {
    expect(sameSet(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true)
    expect(sameSet(new Set(['a']), new Set(['a', 'b']))).toBe(false)
    expect(sameSet(new Set(['a', 'c']), new Set(['a', 'b']))).toBe(false)
  })
})
