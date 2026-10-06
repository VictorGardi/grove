import { describe, expect, it } from 'vitest'
import { serviceFilePath, sseData } from './client'

describe('sseData', () => {
  it('splits data frames and keeps a partial one', () => {
    expect(sseData('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"')).toEqual({
      frames: ['{"a":1}', '{"b":2}'],
      rest: 'data: {"c"',
    })
  })

  it('skips comment blocks such as the heartbeat', () => {
    expect(sseData(': heartbeat\n\ndata: x\n\n')).toEqual({ frames: ['x'], rest: '' })
  })

  it('handles CRLF and joins multi-line data', () => {
    expect(sseData('data: a\r\ndata: b\r\n\r\n')).toEqual({ frames: ['a\nb'], rest: '' })
  })
})

describe('serviceFilePath', () => {
  it('uses XDG_STATE_HOME when set, else ~/.local/state', () => {
    expect(serviceFilePath({ XDG_STATE_HOME: '/x' }, '/home/u')).toBe('/x/opencode/service.json')
    expect(serviceFilePath({}, '/home/u')).toBe('/home/u/.local/state/opencode/service.json')
  })
})
