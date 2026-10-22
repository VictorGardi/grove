import { describe, expect, it } from 'vitest'
import { baseChoices, pushRecentBase } from './diffBases'

const refs = { branches: ['main', 'feat/a', 'Dev', 'origin/main', 'origin/release/1.2', 'origin/feat/a'], current: 'feat/a', default: 'main' }

describe('baseChoices', () => {
  it('lists the default then recents with no query, without the current branch or duplicates', () => {
    const recents = ['Dev', 'feat/a', 'main', 'Dev', 'origin/release/1.2', 'gone']
    expect(baseChoices(refs, recents, '').map((c) => [c.name, c.kind])).toEqual([['main', 'default'], ['Dev', 'recent'], ['origin/release/1.2', 'recent']])
    expect(baseChoices(refs, recents, '  ')[0].ref).toBeNull()
  })

  it('caps recents at 5', () => {
    const many = { ...refs, branches: ['main', 'a', 'b', 'c', 'd', 'e', 'f', 'g'] }
    expect(baseChoices(many, ['a', 'b', 'c', 'd', 'e', 'f', 'g'], '').map((c) => c.name)).toEqual(['main', 'a', 'b', 'c', 'd', 'e'])
  })

  it('shows only recents when there is no default', () => {
    expect(baseChoices({ ...refs, default: null }, ['Dev'], '').map((c) => c.name)).toEqual(['Dev'])
  })

  it('matches local and remote names case-insensitively, minus the current branch', () => {
    expect(baseChoices(refs, [], 'DEV').map((c) => c.ref)).toEqual(['Dev'])
    expect(baseChoices(refs, [], 'release')).toEqual([{ ref: 'origin/release/1.2', name: 'origin/release/1.2', kind: 'match' }])
    expect(baseChoices(refs, [], 'feat')).toEqual([{ ref: 'origin/feat/a', name: 'origin/feat/a', kind: 'match' }])
  })

  it('lists the default once, not again as its origin/ alias', () => {
    expect(baseChoices(refs, [], 'main').map((c) => [c.ref, c.kind])).toEqual([[null, 'default']])
  })
})

describe('pushRecentBase', () => {
  it('puts the pick first, drops its duplicate and keeps five', () => {
    expect(pushRecentBase(undefined, 'a')).toEqual(['a'])
    expect(pushRecentBase(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    expect(pushRecentBase(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['f', 'a', 'b', 'c', 'd'])
  })
})
