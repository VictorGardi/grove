import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { shownStatus, statusView } from './sessionStatus'

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'a', projectId: 'p', kind: 'opencode', label: 'a', labelPinned: false, tmuxName: 'grove-a',
    opencodeSessionId: 'ses_a', feature: null, linkPinned: false, action: null,
    startedAt: '2026-10-05T10:00:00.000Z', endedAt: null, lastStatus: 'running', ...over,
  }
}

describe('shownStatus', () => {
  it('prefers gone, then the live status, then tmux running', () => {
    expect(shownStatus(session({ lastStatus: 'gone', status: 'working' }))).toBe('gone')
    expect(shownStatus(session({ status: 'working' }))).toBe('working')
    expect(shownStatus(session({ status: 'idle' }))).toBe('idle')
    expect(shownStatus(session())).toBe('running')
  })

  it('uses the shown status as label and tone', () => {
    expect(statusView(session({ status: 'working' }))).toEqual({ label: 'working', tone: 'working' })
  })
})
