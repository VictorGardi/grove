import { describe, expect, it } from 'vitest'
import { mintSessionId } from './opencodeId'

const T = 1776959130999 // time_created of ses_244fb7288ffe7YEch15CUa2BbN on this machine

describe('mintSessionId', () => {
  it('matches the time prefix of a real OpenCode id', () => {
    expect(mintSessionId(T).slice(0, 16)).toBe('ses_244fb7288ffe')
  })

  it('has the OpenCode shape', () => {
    const id = mintSessionId(T)
    expect(id).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(id).toHaveLength(30)
  })

  it('sorts newer ids first', () => {
    expect(mintSessionId(T + 1000) < mintSessionId(T)).toBe(true)
  })

  it('differs in the random part at the same time', () => {
    expect(mintSessionId(T)).not.toBe(mintSessionId(T))
  })
})
