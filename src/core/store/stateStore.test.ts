import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_UI, type StateFile } from '@shared/types'
import { newSession } from '../sessions'
import { loadState, saveState } from './stateStore'

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-')), 'state.json')

describe('stateStore', () => {
  it('returns an empty state for a missing file', () => {
    expect(loadState(tmpFile())).toEqual({ schemaVersion: 1, sessions: [], ui: DEFAULT_UI })
  })

  it.each([['bad JSON', '{'], ['unknown schemaVersion', '{"schemaVersion":9}']])(
    'moves a file with %s aside',
    (_, content) => {
      const file = tmpFile()
      fs.writeFileSync(file, content)
      const onBad = vi.fn()
      expect(loadState(file, onBad)).toEqual({ schemaVersion: 1, sessions: [], ui: DEFAULT_UI })
      expect(onBad).toHaveBeenCalledTimes(1)
      expect(fs.readdirSync(path.dirname(file))).toEqual([expect.stringMatching(/^state\.json\.bad-\d+$/)])
    }
  )

  it('round-trips', () => {
    const file = tmpFile()
    const s: StateFile = {
      schemaVersion: 1,
      sessions: [newSession({ projectId: 'p', kind: 'terminal', now: new Date(), id: 'a' })],
      ui: { sidebarWidth: 300, focusedSessionId: 'a' },
    }
    saveState(file, s)
    expect(loadState(file)).toEqual(s)
  })

  it('fills in a missing ui field', () => {
    const file = tmpFile()
    fs.writeFileSync(file, '{"schemaVersion":1,"sessions":[]}')
    expect(loadState(file).ui).toEqual(DEFAULT_UI)
  })
})
