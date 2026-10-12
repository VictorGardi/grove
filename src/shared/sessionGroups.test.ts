import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { canParent, hasChildren, leaderOf, orphanChildren, resolveParent, withParent } from './sessionGroups'

const s = (id: string, parentId?: string): Session => ({ id, parentId } as Session)
const parentOf = (list: Session[], id: string) => list.find((x) => x.id === id)?.parentId ?? null

describe('leaderOf', () => {
  it('is the session itself when it has no parent', () => expect(leaderOf([s('a')], 'a')?.id).toBe('a'))
  it('is the parent of a child, so a session spawned by a child is its sibling', () =>
    expect(leaderOf([s('a'), s('b', 'a')], 'b')?.id).toBe('a'))
  it('falls back to the session when its parent is gone', () => expect(leaderOf([s('b', 'a')], 'b')?.id).toBe('b'))
  it('is null for an unknown id', () => expect(leaderOf([s('a')], 'x')).toBeNull())
})

describe('resolveParent', () => {
  const all = [s('a'), s('b', 'a'), s('c'), s('d')]
  it('resolves a child to its group leader', () => expect(resolveParent(all, 'b')).toEqual({ ok: true, data: 'a' }))
  it('refuses an unknown parent', () => expect(resolveParent(all, 'x')).toEqual({ ok: false, error: 'no-parent' }))
  it('refuses a session as its own parent, directly or through its leader', () => {
    expect(resolveParent(all, 'c', 'c')).toEqual({ ok: false, error: 'same-session' })
    expect(resolveParent(all, 'b', 'a')).toEqual({ ok: false, error: 'same-session' }) // b's leader is a
  })
  it('refuses a leader being placed under another session', () =>
    expect(resolveParent(all, 'c', 'a')).toEqual({ ok: false, error: 'is-parent' }))
  it('accepts a session with no children', () => expect(resolveParent(all, 'a', 'd')).toEqual({ ok: true, data: 'a' }))
})

describe('withParent', () => {
  it('sets, re-parents and clears', () => {
    const all = [s('a'), s('c'), s('d')]
    const set = withParent(all, 'd', 'a')
    expect(set.ok && parentOf(set.data, 'd')).toBe('a')
    const moved = set.ok && withParent(set.data, 'd', 'c')
    expect(moved && moved.ok && parentOf(moved.data, 'd')).toBe('c')
    const cleared = moved && moved.ok && withParent(moved.data, 'd', null)
    expect(cleared && cleared.ok && parentOf(cleared.data, 'd')).toBeNull()
  })
  it('refuses making a leader a child', () => {
    expect(withParent([s('a'), s('b', 'a'), s('c')], 'a', 'c')).toEqual({ ok: false, error: 'is-parent' })
  })
  it('refuses an unknown session', () => expect(withParent([s('a')], 'x', 'a')).toEqual({ ok: false, error: 'not-found' }))
})

describe('orphanChildren', () => {
  it('promotes children of a removed parent and touches nothing else', () => {
    const left = orphanChildren([s('b', 'a'), s('c', 'z'), s('d')], ['a'])
    expect(parentOf(left, 'b')).toBeNull()
    expect(parentOf(left, 'c')).toBe('z')
  })
  it('returns the same array when no child is affected', () => {
    const all = [s('a'), s('b', 'a')]
    expect(orphanChildren(all, ['q'])).toBe(all)
  })
})

describe('canParent / hasChildren', () => {
  const all = [s('a'), s('b', 'a'), s('c'), s('d')]
  it('offers roots other than the session', () => {
    expect(canParent(all, 'd', all[0])).toBe(true)
    expect(canParent(all, 'd', all[3])).toBe(false)
    expect(canParent(all, 'd', all[1])).toBe(false) // a child is not a parent
  })
  it('offers nothing for a session that has children', () => {
    expect(hasChildren(all, 'a')).toBe(true)
    expect(canParent(all, 'a', all[2])).toBe(false)
  })
})
