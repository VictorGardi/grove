import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findCopilotSession } from './discover.ts'

const SESSION = '00000000-0000-4000-8000-0000000000c1'
const OTHER = '00000000-0000-4000-8000-0000000000c2'
const OLDER = '00000000-0000-4000-8000-0000000000c3'

describe('findCopilotSession', () => {
  let home: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-copilot-discover-'))
  })

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
  })

  const session = (id: string, cwd: string, created: string) => {
    const dir = path.join(home, 'copilot', 'session-state', id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'workspace.yaml'), `id: ${id}\ncwd: ${cwd}\ncreated_at: ${created}\n`)
  }

  const find = (options: { cwd?: string; since?: number; exclude?: ReadonlySet<string> } = {}) =>
    findCopilotSession({
      copilotHome: path.join(home, 'copilot'),
      cwd: options.cwd ?? home,
      since: options.since ?? Date.now() - 10_000,
      exclude: options.exclude,
    })

  it('returns the single eligible session, with nothing from other folders or older sessions', () => {
    // Times are real (folders are changed now), so the session folders are written after `since`.
    const now = Date.now()
    const iso = (ms: number) => new Date(ms).toISOString()
    session(SESSION, home, iso(now - 4000))
    session(OTHER, '/elsewhere', iso(now - 4000))
    session(OLDER, home, iso(now - 3_600_000))
    expect(find({ since: now - 10_000 })).toBe(SESSION)
    expect(find({ cwd: '/nowhere' })).toBeUndefined()
    expect(find({ since: now + 1000 })).toBeUndefined()
  })

  it('skips an excluded session and takes the remaining one', () => {
    const now = Date.now()
    const iso = (ms: number) => new Date(ms).toISOString()
    session(SESSION, home, iso(now - 4000))
    session(OTHER, home, iso(now - 3000))
    expect(find({ exclude: new Set([SESSION]) })).toBe(OTHER)
  })

  it('returns undefined when more than one eligible session matches, so the ambiguity is never guessed', () => {
    const now = Date.now()
    const iso = (ms: number) => new Date(ms).toISOString()
    session(SESSION, home, iso(now - 4000))
    session(OTHER, home, iso(now - 3000))
    expect(find()).toBeUndefined()
    // The ambiguity is only about the eligible count: once one stops being a candidate, the other is found.
    expect(find({ exclude: new Set([SESSION]) })).toBe(OTHER)
  })
})
