import { describe, expect, it, vi } from 'vitest'
import { createOpencodeNameSource, openCodeTitle } from './name.ts'

const list = [
  { id: 'ses_a', title: 'Map color differences not showing' },
  { id: 'ses_b', title: 'New session - 2026-11-10T10:00:00.000Z' },
  { id: 'ses_c', title: 'Child session - sub' },
  { id: 'ses_d' },
]

describe('openCodeTitle', () => {
  it('finds the session in a bare or wrapped list', () => {
    expect(openCodeTitle(list, 'ses_a')).toBe('Map color differences not showing')
    expect(openCodeTitle({ data: list }, 'ses_a')).toBe('Map color differences not showing')
  })

  it('has no name for OpenCode’s placeholder titles, a missing title, or an unlisted session', () => {
    for (const id of ['ses_b', 'ses_c', 'ses_d', 'ses_zzz']) expect(openCodeTitle(list, id)).toBeUndefined()
    expect(openCodeTitle('nope', 'ses_a')).toBeUndefined()
  })
})

describe('the OpenCode name source', () => {
  it('delivers the title when it appears, and treats an outage as not named yet', async () => {
    let body: unknown = list.slice(1)
    const fetchJson = vi.fn(async () => {
      if (body === 'down') throw new Error('refused')
      return body
    })
    const onName = vi.fn()
    const source = createOpencodeNameSource({ sessionId: 'ses_b', fetchJson, onName, intervalMs: 3_600_000 })
    await source.drain()
    body = 'down'
    await source.drain()
    body = [{ id: 'ses_b', title: 'Review the modal' }]
    await source.drain()
    expect(onName.mock.calls).toEqual([['Review the modal']])
    expect(fetchJson).toHaveBeenCalledWith('/api/session')
    source.close()
  })
})
