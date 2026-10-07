import { describe, expect, it } from 'vitest'
import type { Project, Session } from '@shared/types'
import { DEFAULT_GRID_VIEW, focusAfterRemove, gridCols, gridShown, layoutLabel, paneTitle, visibleMembers, withMember } from './gridView'

describe('gridCols', () => {
  it('picks 1, 2 or 3 columns by count', () => {
    expect([0, 1, 2, 4, 5, 9].map((n) => gridCols(n))).toEqual([1, 1, 2, 2, 3, 3])
  })
  it('is capped by maxCols', () => {
    expect(gridCols(9, 2)).toBe(2)
    expect(gridCols(4, 1)).toBe(1)
    expect(gridCols(2, 3)).toBe(2)
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
  const ids = (v: Partial<typeof DEFAULT_GRID_VIEW>) => visibleMembers(members, { ...DEFAULT_GRID_VIEW, ...v }).map((x) => x.id)
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
})

describe('layoutLabel', () => {
  it('is cols×rows of the visible panes', () => {
    expect([0, 1, 2, 5, 9].map((n) => layoutLabel(n, 3))).toEqual(['0×0', '1×1', '2×1', '3×2', '3×3'])
  })
  it('respects the maximum columns', () => {
    expect(layoutLabel(4, 1)).toBe('1×4')
    expect(layoutLabel(9, 2)).toBe('2×5')
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
