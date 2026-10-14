import { describe, expect, it } from 'vitest'
import type { Project, Session } from '@shared/types'
import {
  DEFAULT_GRID_VIEW, dividers, hasArrangement, withoutArrangement, equalTracks, focusAfterRemove, gridCols, gridShown, layoutLabel, minTrackFraction, nextSpan, paneSpans, paneTitle,
  placedSpan, placePanes, resizeTracks, shapeKey, swapMembers, trackFractions, visibleMembers, withMember, withSpan, withTracks,
} from './gridView'

const projects = [{ id: 'p', name: 'grove', path: '/src/p' }, { id: 'q', name: 'other', path: '/src/q' }] as Project[]

describe('gridCols', () => {
  it('picks 1, 2 or 3 columns by count', () => {
    expect([0, 1, 2, 4, 5, 9].map((n) => gridCols(n))).toEqual([1, 1, 2, 2, 3, 3])
  })
})

describe('gridShown', () => {
  const ui = (open: boolean, members: string[], focusedSessionId: string | null) => ({ grid: { open, members }, focusedSessionId })
  it('needs the grid on, members, and a focused member', () => {
    expect(gridShown(ui(true, ['a', 'b'], 'b'))).toBe(true)
    expect(gridShown(ui(false, ['a'], 'a'))).toBe(false)
    expect(gridShown(ui(true, [], 'a'))).toBe(false)
    expect(gridShown(ui(true, ['a'], 'z'))).toBe(false)
    expect(gridShown(ui(true, ['a'], null))).toBe(false)
  })
})

describe('withMember', () => {
  it('adds a member last and removes it again', () => {
    const added = withMember({ open: false, members: ['a'] }, 'b')
    expect(added).toEqual({ open: false, members: ['a', 'b'] })
    expect(withMember(added, 'a')).toEqual({ open: false, members: ['b'] })
  })
  it('keeps open as it was', () => {
    expect(withMember({ open: true, members: ['a'] }, 'b').open).toBe(true)
  })
  it('refuses a tenth member', () => {
    const full = { open: true, members: Array.from({ length: 9 }, (_, i) => 's' + i) }
    expect(withMember(full, 'x')).toBe(full)
    expect(withMember(full, 's3').members).toHaveLength(8)
  })
  it('closes the grid when the last member leaves', () => {
    expect(withMember({ open: true, members: ['a'] }, 'a')).toEqual({ open: false, members: [] })
  })
})

describe('paneTitle', () => {
  const session = { label: 'fix-login' } as Session
  it('is project / label', () => {
    expect(paneTitle({ name: 'grove' } as Project, session)).toBe('grove / fix-login')
  })
  it('is the label alone without a project', () => {
    expect(paneTitle(undefined, session)).toBe('fix-login')
  })
})

describe('visibleMembers', () => {
  const m = (id: string, projectId: string, lastStatus: Session['lastStatus'] = 'running') => ({ id, projectId, lastStatus }) as Session
  const members = [m('a', 'p'), m('b', 'q', 'gone'), m('c', 'p', 'gone'), m('d', 'q')]
  const ids = (v: Partial<typeof DEFAULT_GRID_VIEW>, over: Project[] = projects) =>
    visibleMembers(members, { ...DEFAULT_GRID_VIEW, ...v }, over).map((x) => x.id)
  it('shows everything by default, in order', () => {
    expect(ids({})).toEqual(['a', 'b', 'c', 'd'])
  })
  it('filters by project', () => {
    expect(ids({ filter: 'q' })).toEqual(['b', 'd'])
  })
  it('ignores a filter for a project with no members', () => {
    expect(ids({ filter: 'zzz' })).toEqual(['a', 'b', 'c', 'd'])
  })
  it('hides ended members', () => {
    expect(ids({ hideEnded: true })).toEqual(['a', 'd'])
  })
  it('combines the filter and hide ended', () => {
    expect(ids({ filter: 'p', hideEnded: true })).toEqual(['a'])
  })

  // A filter names a repo (one tab per checkout), so it keeps every pane in its checkouts.
  const withWorktree = [
    { id: 'p', name: 'grove', path: '/src/p' },
    { id: 'wt', name: 'grove · fix-auth', path: '/src/wt', worktreeOf: 'p' },
    { id: 'q', name: 'other', path: '/src/q' },
  ] as Project[]

  it('keeps the panes of a repo\'s worktrees when the filter names its checkout', () => {
    const many = [m('a', 'p'), m('b', 'wt'), m('c', 'q')]
    expect(visibleMembers(many, { ...DEFAULT_GRID_VIEW, filter: 'p' }, withWorktree).map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('keeps the same panes when the filter names the worktree', () => {
    const many = [m('a', 'p'), m('b', 'wt'), m('c', 'q')]
    expect(visibleMembers(many, { ...DEFAULT_GRID_VIEW, filter: 'wt' }, withWorktree).map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('ignores a filter for a project that is not configured at all', () => {
    expect(visibleMembers(members, { ...DEFAULT_GRID_VIEW, filter: 'zzz' }, withWorktree).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('visibleMembers with a layout', () => {
  it('keeps only as many panes as the layout has cells', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, projectId: 'p', lastStatus: 'running' }) as Session)
    expect(visibleMembers(many, { ...DEFAULT_GRID_VIEW, layout: { cols: 2, rows: 2 } }, projects).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('layoutLabel', () => {
  it('is cols×rows of the visible panes', () => {
    expect([0, 1, 2, 5, 9].map((n) => layoutLabel(n, null))).toEqual(['0×0', '1×1', '2×1', '3×2', '3×3'])
  })
  it('shows a chosen layout as picked', () => {
    expect(layoutLabel(9, { cols: 4, rows: 2 })).toBe('4×2')
  })
})

describe('focusAfterRemove', () => {
  it('takes the next member, else the previous one', () => {
    expect(focusAfterRemove(['a', 'b', 'c'], 'b')).toBe('c')
    expect(focusAfterRemove(['a', 'b', 'c'], 'c')).toBe('b')
  })
  it('is null for the last member or an unknown id', () => {
    expect(focusAfterRemove(['a'], 'a')).toBeNull()
    expect(focusAfterRemove(['a'], 'z')).toBeNull()
  })
})

const shape22 = { cols: 2, rows: 2 }
const ones = (n: number) => Array.from({ length: n }, () => ({ cols: 1, rows: 1 }))

describe('shapeKey', () => {
  it('is cols x rows', () => {
    expect(shapeKey(shape22)).toBe('2x2')
  })
})

describe('paneSpans', () => {
  const ids = ['a', 'b', 'c']
  it('stretches the last pane across its row when nothing was set', () => {
    expect(paneSpans(ids, undefined, shape22).map((x) => x.cols)).toEqual([1, 1, 2])
    expect(paneSpans(['a', 'b', 'c', 'd'], {}, shape22).map((x) => x.cols)).toEqual([1, 1, 1, 1])
    expect(paneSpans(['a'], undefined, { cols: 3, rows: 1 }).map((x) => x.cols)).toEqual([3])
    expect(paneSpans(['a', 'b', 'c', 'd'], undefined, { cols: 3, rows: 2 }).map((x) => x.cols)).toEqual([1, 1, 1, 3])
  })
  it('turns auto-fill off for the whole grid once any pane has a span, even 1x1', () => {
    expect(paneSpans(ids, { a: '1x1' }, shape22).map((x) => x.cols)).toEqual([1, 1, 1])
    expect(paneSpans(ids, { a: 'wide' }, shape22)).toEqual([{ cols: 2, rows: 1 }, { cols: 1, rows: 1 }, { cols: 1, rows: 1 }])
    expect(paneSpans(ids, { b: 'tall' }, shape22)[1]).toEqual({ cols: 1, rows: 2 })
  })
  it('ignores a span the shape cannot hold, but still counts it as manual', () => {
    expect(paneSpans(ids, { a: 'wide' }, { cols: 1, rows: 3 })).toEqual(ones(3))
    expect(paneSpans(ids, { a: 'tall' }, { cols: 3, rows: 1 })).toEqual(ones(3))
  })
  it('ignores spans of sessions that are not shown', () => {
    expect(paneSpans(ids, { gone: 'wide' }, shape22).map((x) => x.cols)).toEqual([1, 1, 2])
  })
})

describe('placePanes', () => {
  const at = (spans: { cols: number; rows: number }[], shape = shape22) => placePanes(spans, shape).map((p) => [p.col, p.row, p.cols, p.rows])
  it('places in row order', () => {
    expect(at(ones(4))).toEqual([[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1]])
  })
  it('puts a wide pane on the next row when it does not fit the rest of this one', () => {
    expect(at([...ones(2), { cols: 2, rows: 1 }], { cols: 3, rows: 2 }).slice(2)).toEqual([[0, 1, 2, 1]])
  })
  it('lets later panes flow around a tall one', () => {
    expect(at([{ cols: 1, rows: 2 }, ...ones(2)])).toEqual([[0, 0, 1, 2], [1, 0, 1, 1], [1, 1, 1, 1]])
  })
  it('cuts a tall pane that would hang below the grid', () => {
    expect(at([...ones(2), { cols: 1, rows: 2 }])).toEqual([[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1]])
  })
  it('places the auto-filled last pane across the leftover row', () => {
    expect(placePanes(paneSpans(['a', 'b', 'c'], undefined, shape22), shape22)[2]).toEqual({ col: 0, row: 1, cols: 2, rows: 1 })
  })
})

describe('dividers', () => {
  const lines = (spans: { cols: number; rows: number }[], shape = shape22) => dividers(placePanes(spans, shape), shape)
  it('has a line per track boundary over separate panes', () => {
    expect(lines(ones(4))).toEqual([{ axis: 'col', index: 1, from: 0, to: 2 }, { axis: 'row', index: 1, from: 0, to: 2 }])
  })
  it('breaks the column line where a wide pane spans it', () => {
    // 3 panes in 2x2: the wide one below leaves the column line only along the top row
    expect(lines(paneSpans(['a', 'b', 'c'], undefined, shape22))).toEqual([{ axis: 'col', index: 1, from: 0, to: 1 }, { axis: 'row', index: 1, from: 0, to: 2 }])
  })
  it('breaks the row line where a tall pane spans it', () => {
    expect(lines([{ cols: 1, rows: 2 }, ...ones(2)])).toEqual([{ axis: 'col', index: 1, from: 0, to: 2 }, { axis: 'row', index: 1, from: 1, to: 2 }])
  })
  it('has no line through a single pane', () => {
    expect(lines(ones(1), { cols: 1, rows: 1 })).toEqual([])
  })
  it('keeps a line beside a pane that has an empty neighbour', () => {
    expect(lines(ones(3))).toEqual([{ axis: 'col', index: 1, from: 0, to: 2 }, { axis: 'row', index: 1, from: 0, to: 2 }])
  })
})

describe('trackFractions', () => {
  it('is equal when nothing valid is stored', () => {
    expect(trackFractions(undefined, 2)).toEqual([0.5, 0.5])
    expect(trackFractions([0.3, 0.7], 3)).toEqual(equalTracks(3))
    expect(trackFractions([0.3, 0.3], 2)).toEqual([0.5, 0.5])
    expect(trackFractions([0, 1], 2)).toEqual([0.5, 0.5])
    expect(trackFractions([NaN, 1], 2)).toEqual([0.5, 0.5])
  })
  it('returns what is stored when it fits', () => {
    expect(trackFractions([0.25, 0.75], 2)).toEqual([0.25, 0.75])
  })
})

describe('minTrackFraction', () => {
  it('is 15% of the grid, or the pane minimum when that is more', () => {
    expect(minTrackFraction(1000, 100, 2)).toBe(0.15)
    expect(minTrackFraction(400, 100, 2)).toBe(0.25)
  })
  it('never asks more than an equal share', () => {
    expect(minTrackFraction(200, 220, 2)).toBe(0.5)
    expect(minTrackFraction(0, 100, 4)).toBe(0.15)
  })
})

describe('resizeTracks', () => {
  const near = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i]))
  it('trades size between the two tracks beside the line', () => {
    near(resizeTracks([0.5, 0.5], 1, 0.1, 0.15), [0.6, 0.4])
    near(resizeTracks([0.25, 0.25, 0.5], 2, -0.05, 0.15), [0.25, 0.2, 0.55])
  })
  it('stops at the minimum on either side', () => {
    near(resizeTracks([0.5, 0.5], 1, 0.9, 0.15), [0.85, 0.15])
    near(resizeTracks([0.5, 0.5], 1, -0.9, 0.15), [0.15, 0.85])
  })
  it('keeps the total at 1', () => {
    expect(resizeTracks([0.2, 0.3, 0.5], 1, 0.07, 0.15).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })
  it('leaves tracks alone for a line that is not there', () => {
    const t = [0.5, 0.5]
    expect(resizeTracks(t, 0, 0.1, 0.15)).toBe(t)
    expect(resizeTracks(t, 2, 0.1, 0.15)).toBe(t)
  })
})

describe('withTracks', () => {
  const base = { open: true, members: ['a'] }
  it('stores an axis under the shape, keeping the other axis and other shapes', () => {
    const one = withTracks(base, shape22, 'cols', [0.3, 0.7])
    expect(one.tracks).toEqual({ '2x2': { cols: [0.3, 0.7] } })
    const two = withTracks(withTracks(one, shape22, 'rows', [0.6, 0.4]), { cols: 3, rows: 1 }, 'cols', [0.2, 0.2, 0.6])
    expect(two.tracks).toEqual({ '2x2': { cols: [0.3, 0.7], rows: [0.6, 0.4] }, '3x1': { cols: [0.2, 0.2, 0.6] } })
  })
  it('resets one axis, and drops the shape and the field when nothing is left', () => {
    const both = withTracks(withTracks(base, shape22, 'cols', [0.3, 0.7]), shape22, 'rows', [0.6, 0.4])
    expect(withTracks(both, shape22, 'cols', null).tracks).toEqual({ '2x2': { rows: [0.6, 0.4] } })
    expect(withTracks(withTracks(both, shape22, 'cols', null), shape22, 'rows', null)).toEqual(base)
  })
  it('does not touch the input', () => {
    withTracks(base, shape22, 'cols', [0.3, 0.7])
    expect(base).toEqual({ open: true, members: ['a'] })
  })
})

describe('spans', () => {
  it('cycles 1x1, wide, tall', () => {
    expect(['1x1', 'wide', 'tall'].map((x) => nextSpan(x as 'wide'))).toEqual(['wide', 'tall', '1x1'])
  })
  it('reads a placed span back', () => {
    expect([{ cols: 1, rows: 1 }, { cols: 2, rows: 1 }, { cols: 1, rows: 2 }].map(placedSpan)).toEqual(['1x1', 'wide', 'tall'])
  })
  it('sets one pane\'s span and keeps the rest', () => {
    const g = withSpan(withSpan({ open: true, members: ['a', 'b'] }, 'a', 'wide'), 'b', '1x1')
    expect(g.spans).toEqual({ a: 'wide', b: '1x1' })
  })
  it('forgets a span when its pane leaves the grid', () => {
    const g = withMember({ open: true, members: ['a', 'b'], spans: { a: 'wide', b: 'tall' } }, 'a')
    expect(g.spans).toEqual({ b: 'tall' })
    expect(withMember(g, 'b').spans).toBeUndefined()
  })
  it('keeps tracks when a member joins or leaves', () => {
    const tracks = { '2x1': { cols: [0.3, 0.7] } }
    expect(withMember({ open: true, members: ['a'], tracks }, 'b').tracks).toBe(tracks)
    expect(withMember({ open: true, members: ['a', 'b'], tracks }, 'b').tracks).toBe(tracks)
  })
})

describe('swapMembers', () => {
  const g = { open: true, members: ['a', 'b', 'c', 'd'], spans: { a: 'wide' as const } }
  it('trades two panes and leaves the others', () => {
    expect(swapMembers(g, 'a', 'c').members).toEqual(['c', 'b', 'a', 'd'])
  })
  it('keeps spans keyed by session, so they travel with the pane', () => {
    expect(swapMembers(g, 'a', 'c').spans).toEqual({ a: 'wide' })
  })
  it('is a no-op for the same or an unknown pane', () => {
    expect(swapMembers(g, 'a', 'a')).toBe(g)
    expect(swapMembers(g, 'a', 'z')).toBe(g)
  })
})

describe('withoutArrangement', () => {
  const g = { open: true, members: ['a', 'b'], spans: { a: 'wide' as const }, tracks: { '2x1': { cols: [0.3, 0.7] } } }
  it('drops spans and tracks and keeps open and order', () => {
    expect(withoutArrangement(g)).toEqual({ open: true, members: ['a', 'b'] })
  })
  it('says whether there is anything to drop', () => {
    expect(hasArrangement(g)).toBe(true)
    expect(hasArrangement({ open: true, members: ['a'], spans: { a: '1x1' } })).toBe(true)
    expect(hasArrangement(withoutArrangement(g))).toBe(false)
    expect(hasArrangement({ open: true, members: ['a'], spans: {}, tracks: {} })).toBe(false)
  })
})
