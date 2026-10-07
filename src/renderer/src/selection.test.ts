import { describe, expect, it } from 'vitest'
import { selectRange } from './selection'

const order = ['a', 'b', 'c', 'd']

describe('selectRange', () => {
  it('takes everything between anchor and target, either direction', () => {
    expect([...selectRange(order, 'a', 'c')]).toEqual(['a', 'b', 'c'])
    expect([...selectRange(order, 'd', 'b')]).toEqual(['b', 'c', 'd'])
  })
  it('falls back to the target alone without a visible anchor', () => {
    expect([...selectRange(order, null, 'b')]).toEqual(['b'])
    expect([...selectRange(order, 'gone', 'b')]).toEqual(['b'])
  })
})
