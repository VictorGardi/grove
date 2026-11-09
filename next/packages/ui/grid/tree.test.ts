import { describe, expect, it } from 'vitest'
import type { Tree } from './tree.ts'
import { addPane, autoTree, dividers, dockPane, equalize, layoutRects, neighborByGeometry, nudge, removePane, repair, resizeSplit, swapPanes } from './tree.ts'

const ids = (n: number) => Array.from({ length: n }, (_, i) => 'p' + i)

describe('autoTree', () => {
  it('is the lone pane for one id and nothing for none', () => {
    expect(autoTree(['a'])).toBe('a')
    expect(autoTree([])).toBeNull()
  })

  it('tiles like the automatic grid: columns by count, the last pane stretching across its row', () => {
    // 5 panes in 3 columns: p0 p1 p2 / p3 p4(spans 2)
    const rects = layoutRects(autoTree(ids(5))!)
    const third = 1 / 3
    expect(rects.p0).toEqual({ x: 0, y: 0, w: expect.closeTo(third), h: 0.5 })
    expect(rects.p2).toMatchObject({ x: expect.closeTo(2 * third), y: 0 })
    expect(rects.p3).toMatchObject({ x: 0, y: 0.5, w: expect.closeTo(third) })
    expect(rects.p4).toMatchObject({ x: expect.closeTo(third), y: 0.5, w: expect.closeTo(2 * third) })
  })

  it('gives one pane the whole area and three panes a stretched last pane', () => {
    expect(layoutRects(autoTree(ids(1))!).p0).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    const three = layoutRects(autoTree(ids(3))!)
    expect(three.p2).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 })
  })
})

describe('addPane', () => {
  it('splits the target pane in half, the new pane after it', () => {
    const rects = layoutRects(addPane(autoTree(['a', 'b'])!, 'b', 'c', { w: 2, h: 1 }))
    expect(rects.a).toEqual({ x: 0, y: 0, w: 0.5, h: 1 })
    expect(rects.b).toEqual({ x: 0.5, y: 0, w: 0.25, h: 1 })
    expect(rects.c).toEqual({ x: 0.75, y: 0, w: 0.25, h: 1 })
  })

  it('splits a wide pane across and a tall pane down, so the halves stay roomy', () => {
    const wide = layoutRects(addPane('a', 'a', 'b', { w: 2, h: 1 }))
    expect(wide.b).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
    const tall = layoutRects(addPane('a', 'a', 'b', { w: 1, h: 2 }))
    expect(tall.b).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 })
  })

  it('puts the new pane after the last one when the target is not in the tree', () => {
    const rects = layoutRects(addPane(autoTree(['a', 'b'])!, 'missing', 'c'))
    expect(Object.keys(rects).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('removePane', () => {
  it('gives the freed space to the sibling', () => {
    const rects = layoutRects(removePane(autoTree(['a', 'b', 'c'])!, 'b')!)
    expect(rects.a).toEqual({ x: 0, y: 0, w: 1, h: 0.5 })
    expect(rects.c).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 })
    // b was beside a in the top row: both rows kept their shape
    expect(Object.keys(rects).sort()).toEqual(['a', 'c'])
  })

  it('leaves a lone pane the whole area, and nothing for the last pane', () => {
    expect(removePane(autoTree(['a', 'b'])!, 'a')).toBe('b')
    expect(removePane('a', 'a')).toBeNull()
  })

  it('leaves the tree alone when the pane is not in it', () => {
    const tree = autoTree(['a', 'b'])!
    expect(removePane(tree, 'z')).toEqual(tree)
  })
})

describe('swapPanes', () => {
  it('trades places and keeps the sizes', () => {
    const tree = autoTree(['a', 'b', 'c'])!
    const before = layoutRects(tree)
    const after = layoutRects(swapPanes(tree, 'a', 'c'))
    expect(after.c).toEqual(before.a)
    expect(after.a).toEqual(before.c)
    expect(after.b).toEqual(before.b)
  })

  it('leaves the tree alone for the same pane or an unknown one', () => {
    const tree = autoTree(['a', 'b'])!
    expect(swapPanes(tree, 'a', 'a')).toEqual(tree)
    expect(swapPanes(tree, 'a', 'z')).toEqual(tree)
  })
})

describe('dockPane', () => {
  it('moves a pane to an edge of another, splitting its space in half', () => {
    const tree = autoTree(['a', 'b', 'c', 'd'])!
    const rects = layoutRects(dockPane(tree, 'd', 'a', 'left'))
    expect(rects.d).toEqual({ x: 0, y: 0, w: 0.25, h: 0.5 })
    expect(rects.a).toEqual({ x: 0.25, y: 0, w: 0.25, h: 0.5 })
    expect(rects.b).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 })
    // d's old slot went to c
    expect(rects.c).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 })
  })

  it('docks above and below, and to the right', () => {
    const tree = autoTree(['a', 'b'])!
    expect(layoutRects(dockPane(tree, 'b', 'a', 'top')).b).toEqual({ x: 0, y: 0, w: 1, h: 0.5 })
    expect(layoutRects(dockPane(tree, 'b', 'a', 'bottom')).b).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 })
    expect(layoutRects(dockPane(autoTree(['a', 'b', 'c'])!, 'c', 'a', 'right')).c).toEqual({ x: 0.25, y: 0, w: 0.25, h: 1 })
  })

  it('leaves the tree alone when a pane is docked onto itself or either is unknown', () => {
    const tree = autoTree(['a', 'b'])!
    expect(dockPane(tree, 'a', 'a', 'left')).toEqual(tree)
    expect(dockPane(tree, 'a', 'z', 'left')).toEqual(tree)
    expect(dockPane(tree, 'z', 'a', 'left')).toEqual(tree)
  })
})

describe('dividers', () => {
  it('lists each split with the area it divides, so a divider can be drawn on its seam', () => {
    const list = dividers(autoTree(['a', 'b', 'c'])!)
    expect(list.map((d) => d.dir)).toEqual(['col', 'row'])
    expect(list[0]).toMatchObject({ path: [], area: { x: 0, y: 0, w: 1, h: 1 }, ratio: 0.5 })
    expect(list[1]).toMatchObject({ path: ['a'], area: { x: 0, y: 0, w: 1, h: 0.5 }, ratio: 0.5 })
  })
})

describe('resizeSplit', () => {
  const size = { w: 1000, h: 500 }
  const min = { w: 200, h: 100 }

  it('moves a divider and only changes the two sides of that split', () => {
    const rects = layoutRects(resizeSplit(autoTree(['a', 'b', 'c'])!, ['a'], 0.25, size, min))
    expect(rects.a.w).toBe(0.25)
    expect(rects.b).toMatchObject({ x: 0.25, w: 0.75 })
    expect(rects.c).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 })
  })

  it('stops a pane at its minimum size', () => {
    const tree = resizeSplit(autoTree(['a', 'b'])!, [], 0.01, size, min)
    expect(layoutRects(tree).a.w * size.w).toBe(200)
    const other = resizeSplit(autoTree(['a', 'b'])!, [], 0.99, size, min)
    expect(layoutRects(other).b.w * size.w).toBeCloseTo(200)
  })

  it('keeps room for every pane stacked on a side', () => {
    // a beside a column of b, c, d: the right side needs 200 x 300
    const tree = dockPane(dockPane(autoTree(['a', 'b'])!, 'c', 'b', 'bottom'), 'd', 'c', 'bottom')
    const rects = layoutRects(resizeSplit(tree, [], 0.99, { w: 1000, h: 400 }, min))
    expect(rects.b.w * 1000).toBeCloseTo(200)
    expect(rects.b.h * 400).toBeGreaterThanOrEqual(100)
  })

  it('does nothing when the area is too small for both sides, or the path is wrong', () => {
    const tree = autoTree(['a', 'b'])!
    expect(resizeSplit(tree, [], 0.3, { w: 300, h: 500 }, min)).toEqual(tree)
    expect(resizeSplit(tree, ['b'], 0.3, size, min)).toEqual(tree)
  })
})

describe('nudge', () => {
  const size = { w: 1000, h: 500 }
  const min = { w: 200, h: 100 }

  it('moves the divider next to the pane in the direction of the key', () => {
    const tree = autoTree(['a', 'b'])!
    expect(layoutRects(nudge(tree, 'a', 'right', 0.05, size, min)).a.w).toBeCloseTo(0.55)
    expect(layoutRects(nudge(tree, 'a', 'left', 0.05, size, min)).a.w).toBeCloseTo(0.45)
    // b's divider is on its left: moving right shrinks b
    expect(layoutRects(nudge(tree, 'b', 'right', 0.05, size, min)).b.w).toBeCloseTo(0.45)
  })

  it('moves the nearest divider, not an outer one', () => {
    // (a | b) | c: a's right edge is the inner divider
    const tree: Tree = { dir: 'row', ratio: 0.8, a: { dir: 'row', ratio: 0.5, a: 'a', b: 'b' }, b: 'c' }
    const rects = layoutRects(nudge(tree, 'a', 'right', 0.05, size, min))
    expect(rects.a.w).toBeCloseTo(0.8 * 0.55)
    expect(rects.c.x).toBeCloseTo(0.8)
  })

  it('moves the divider above or below a pane, and leaves the tree when there is none that way', () => {
    const tree = autoTree(['a', 'b', 'c'])!
    expect(layoutRects(nudge(tree, 'c', 'up', 0.1, size, min)).c.h).toBeCloseTo(0.6)
    expect(nudge(autoTree(['a', 'b'])!, 'a', 'down', 0.1, size, min)).toEqual(autoTree(['a', 'b']))
  })
})

describe('equalize', () => {
  it('shares a chain of same-direction splits equally between its panes', () => {
    const row = addPane(autoTree(['a', 'b'])!, 'b', 'c', { w: 2, h: 1 })
    const rects = layoutRects(equalize(row, []))
    expect(rects.a.w).toBeCloseTo(1 / 3)
    expect(rects.b.w).toBeCloseTo(1 / 3)
    expect(rects.c.w).toBeCloseTo(1 / 3)
  })

  it('halves the space of a split between a pane and a stack', () => {
    const tree = dockPane(dockPane(autoTree(['a', 'b'])!, 'c', 'b', 'bottom'), 'd', 'c', 'bottom')
    const rects = layoutRects(equalize(tree, []))
    expect(rects.a.w).toBe(0.5)
  })
})

describe('neighborByGeometry', () => {
  // a tall pane on the left, b over c on the right
  const tree: Tree = { dir: 'row', ratio: 0.5, a: 'a', b: { dir: 'col', ratio: 0.5, a: 'b', b: 'c' } }

  it('finds the pane next to another in a direction', () => {
    expect(neighborByGeometry(tree, 'a', 'right')).toBe('b')
    expect(neighborByGeometry(tree, 'b', 'down')).toBe('c')
    expect(neighborByGeometry(tree, 'c', 'up')).toBe('b')
    expect(neighborByGeometry(tree, 'c', 'left')).toBe('a')
  })

  it('stays put at an edge or for an unknown pane', () => {
    expect(neighborByGeometry(tree, 'a', 'left')).toBe('a')
    expect(neighborByGeometry(tree, 'b', 'up')).toBe('b')
    expect(neighborByGeometry(tree, 'z', 'up')).toBe('z')
  })

  it('picks the neighbour facing the middle of the pane when several touch it', () => {
    expect(neighborByGeometry(tree, 'a', 'right')).toBe('b')
    const lower: Tree = { dir: 'row', ratio: 0.5, a: { dir: 'col', ratio: 0.8, a: 'a', b: 'd' }, b: tree.b }
    expect(neighborByGeometry(lower, 'a', 'right')).toBe('b')
    expect(neighborByGeometry(lower, 'd', 'right')).toBe('c')
  })
})

describe('repair', () => {
  it('keeps a tree that matches the panes', () => {
    const tree = autoTree(['a', 'b', 'c'])!
    expect(repair(tree, ['a', 'b', 'c'])).toEqual(tree)
  })

  it('drops panes that are no longer members and splits in new ones', () => {
    const rects = layoutRects(repair(autoTree(['a', 'b', 'c'])!, ['a', 'c', 'd'])!)
    expect(Object.keys(rects).sort()).toEqual(['a', 'c', 'd'])
  })

  it('falls back to the automatic tree for something that is not a tree', () => {
    const members = ['a', 'b']
    for (const bad of [42, { dir: 'row' }, { dir: 'sideways', ratio: 0.5, a: 'a', b: 'b' }, { dir: 'row', ratio: Number.NaN, a: 'a', b: 'b' }, { dir: 'row', ratio: 0.5, a: 'a', b: 'a' }]) {
      expect(repair(bad, members)).toEqual(autoTree(members))
    }
  })

  it('has no tree for no members', () => {
    expect(repair(autoTree(['a', 'b'])!, [])).toBeNull()
  })

  it('keeps ratios off the edges so no pane vanishes', () => {
    const tree = repair({ dir: 'row', ratio: 0, a: 'a', b: 'b' }, ['a', 'b'])
    expect(layoutRects(tree!).a.w).toBeGreaterThan(0)
  })
})
