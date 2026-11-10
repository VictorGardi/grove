import { describe, expect, it } from 'vitest'
import { previousOf, visited, stepFrom } from './recent-tabs.ts'

describe('visited', () => {
  it('moves the tab to the front and keeps the rest in order', () => {
    expect(visited(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })
  it('puts a tab not yet in the list at the front', () => {
    expect(visited([], 'a')).toEqual(['a'])
    expect(visited(['a'], 'c')).toEqual(['c', 'a'])
  })
})

describe('previousOf', () => {
  it('is the most recent tab other than the current one', () => {
    expect(previousOf(['a', 'b', 'c'], 'a')).toBe('b')
    expect(previousOf(['a', 'b', 'c'], 'c')).toBe('a')
  })

  it('toggles between the two most recent tabs', () => {
    let history = visited(visited(['a'], 'b'), 'a') // ['a', 'b']
    expect(previousOf(history, 'a')).toBe('b')
    history = visited(history, 'b') // ['b', 'a']
    expect(previousOf(history, 'b')).toBe('a')
    history = visited(history, 'a') // ['a', 'b']
    expect(previousOf(history, 'a')).toBe('b')
  })

  it('is undefined with no other tab', () => {
    expect(previousOf(['a'], 'a')).toBeUndefined()
    expect(previousOf([], null)).toBeUndefined()
  })

  it('is the most recent tab when the current one is not in the history', () => {
    expect(previousOf(['b'], 'a')).toBe('b')
  })
})

describe('stepFrom', () => {
  it('steps along the tabs and wraps', () => {
    expect(stepFrom(['a', 'b', 'c'], 'c', 1)).toBe('a')
    expect(stepFrom(['a', 'b', 'c'], 'a', -1)).toBe('c')
    expect(stepFrom(['a', 'b'], 'a', 1)).toBe('b')
  })
  it('has nowhere to go with fewer than two tabs', () => {
    expect(stepFrom(['a'], 'a', 1)).toBeUndefined()
    expect(stepFrom([], null, 1)).toBeUndefined()
  })
})
