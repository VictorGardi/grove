import { describe, expect, it, vi } from 'vitest'
import { cleanName, NAME_MAX, nameReporter } from './nameSource.ts'

describe('cleanName', () => {
  it('makes one trimmed line', () => {
    expect(cleanName('  fix\n the\t importer  ')).toBe('fix the importer')
  })

  it('has nothing for an empty or non-text value', () => {
    expect(cleanName('  \n ')).toBeUndefined()
    expect(cleanName(42)).toBeUndefined()
    expect(cleanName(undefined)).toBeUndefined()
  })

  it('cuts a long name at a word, with an ellipsis, within the limit', () => {
    const name = cleanName('word '.repeat(60))
    expect(name?.endsWith('…')).toBe(true)
    expect(name!.length).toBeLessThanOrEqual(NAME_MAX)
    expect(cleanName('x'.repeat(200))!.length).toBe(NAME_MAX)
  })
})

describe('nameReporter', () => {
  it('delivers a name once, again only when it changes, and never an undefined one', () => {
    const onName = vi.fn()
    const report = nameReporter('Test', onName)
    report(undefined)
    report('a')
    report('a')
    report('b')
    expect(onName.mock.calls).toEqual([['a'], ['b']])
  })

  it('logs a throwing callback and carries on', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const report = nameReporter('Test', () => {
      throw new Error('boom')
    })
    expect(() => report('a')).not.toThrow()
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})
