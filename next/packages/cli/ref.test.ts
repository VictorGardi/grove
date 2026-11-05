import { describe, expect, it } from 'vitest'
import { resolveSpaceRef, resolveTabRef } from './ref.ts'

describe('resolveTabRef', () => {
  const tabs = [
    { id: 'abcd1111', label: 'one' },
    { id: 'abcd2222', label: 'two' },
    { id: 'ffff3333', label: 'dup' },
    { id: 'eeee4444', label: 'dup' },
    { id: 'wxyz1111', label: null },
  ]

  it('matches a full id, a unique prefix and an exact label', () => {
    expect(resolveTabRef(tabs, 'abcd1111')).toEqual({ ok: true, id: 'abcd1111' })
    expect(resolveTabRef(tabs, 'abcd2')).toEqual({ ok: true, id: 'abcd2222' })
    expect(resolveTabRef(tabs, 'one')).toEqual({ ok: true, id: 'abcd1111' })
  })

  it('does not match a prefix shorter than 4', () => {
    expect(resolveTabRef(tabs, 'abc')).toEqual({ ok: false, error: 'not-found' })
  })

  it('reports ambiguous prefixes and labels, and unknown refs', () => {
    expect(resolveTabRef(tabs, 'abcd')).toEqual({ ok: false, error: 'ambiguous' })
    expect(resolveTabRef(tabs, 'dup')).toEqual({ ok: false, error: 'ambiguous' })
    expect(resolveTabRef(tabs, 'nope')).toEqual({ ok: false, error: 'not-found' })
  })

  it('prefers an id match over a label', () => {
    const list = [{ id: 'wxyz1111', label: 'x' }, { id: 'other111', label: 'wxyz1111' }]
    expect(resolveTabRef(list, 'wxyz1111')).toEqual({ ok: true, id: 'wxyz1111' })
  })
})

describe('resolveSpaceRef', () => {
  const spaces = [
    { id: 'sp_aaaa1111', path: '/w/a' },
    { id: 'sp_aaaa2222', path: '/w/a' },
    { id: 'sp_cccc3333', path: '/w/c' },
  ]
  it('takes an id, a unique prefix, or a heading', () => {
    expect(resolveSpaceRef(spaces, 'sp_aaaa2222')).toEqual({ ok: true, id: 'sp_aaaa2222' })
    expect(resolveSpaceRef(spaces, 'sp_cc')).toEqual({ ok: true, id: 'sp_cccc3333' })
    expect(resolveSpaceRef(spaces, '/w/a')).toEqual({ ok: true, id: 'sp_aaaa1111' })
    expect(resolveSpaceRef(spaces, '/w/a#2')).toEqual({ ok: true, id: 'sp_aaaa2222' })
  })
  it('refuses an ambiguous or unknown ref', () => {
    expect(resolveSpaceRef(spaces, 'sp_aa')).toEqual({ ok: false, error: 'ambiguous' })
    expect(resolveSpaceRef(spaces, '/w/zzz')).toEqual({ ok: false, error: 'not-found' })
  })
})
