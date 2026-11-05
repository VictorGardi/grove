import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatusEvent } from '../../status/contract.ts'
import { createCopilotAdapter } from './adapter.ts'

const FIXTURES = new URL('./fixtures/', import.meta.url)
const fixture = (name: string) => fs.readFileSync(new URL(name, FIXTURES), 'utf8')
const SESSION = '00000000-0000-4000-8000-0000000000c1'
const NOW = 9000
type Logged = { event: StatusEvent; at: number }
// The spool source also reports its heartbeat on each poll; these tests look at the real events only.
const kinds = (events: Logged[]) => events.map((e) => e.event).filter((e) => e.kind !== 'heartbeat')

// The copilot watch: the hook spool of a tab in a Grove home, and Copilot's log in its own home. Both are temp dirs.
describe('copilot watch', () => {
  let home: string
  let copilotHome: string
  let spool: string
  const watches: Array<{ close: () => void }> = []

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-copilot-home-'))
    copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-copilot-copilot-'))
    spool = path.join(home, 'agents', 'copilot', 't1.jsonl')
  })

  afterEach(() => {
    for (const w of watches.splice(0)) w.close()
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(copilotHome, { recursive: true, force: true })
  })

  const watchTab = (events: Logged[], sessionId = SESSION) => {
    const w = createCopilotAdapter({ copilotHome }).watch({
      tabId: 't1',
      sessionId,
      home,
      clock: () => NOW,
      onEvent: (event, at) => events.push({ event, at }),
    })
    watches.push(w)
    return w
  }

  const logFile = (sessionId = SESSION) => path.join(copilotHome, 'session-state', sessionId, 'events.jsonl')
  const writeLog = (text: string, sessionId = SESSION) => {
    fs.mkdirSync(path.dirname(logFile(sessionId)), { recursive: true })
    fs.appendFileSync(logFile(sessionId), text)
  }

  it('folds the hook spool into working, needs-you, working and finished, in order, with each record\'s time', () => {
    fs.mkdirSync(path.dirname(spool), { recursive: true })
    fs.writeFileSync(spool, fixture('hooks-permission-turn.jsonl'))
    const events: Logged[] = []
    watchTab(events) // the first drain runs on creation, so the events are there at once
    expect(kinds(events)).toEqual([
      { kind: 'working' },
      { kind: 'needs-you', reason: 'permission' },
      { kind: 'working' },
      { kind: 'finished' },
    ])
    expect(events.filter((e) => e.event.kind === 'finished')[0].at).toBe(Date.parse('2026-10-22T10:00:09Z'))
  })

  it('a new hook record after the watch is delivered as it lands', async () => {
    fs.mkdirSync(path.dirname(spool), { recursive: true })
    const events: Logged[] = []
    watchTab(events)
    expect(events).toEqual([])
    fs.appendFileSync(spool, '{"t":"2026-10-22T10:00:00Z","e":{"hook_event_name":"userPromptSubmitted"}}\n')
    await vi.waitFor(() => expect(kinds(events)).toEqual([{ kind: 'working' }]), { timeout: 4000 })
  })

  it('a restored tab whose log turn already ended reports nothing, so an old end is not replayed', () => {
    writeLog(JSON.stringify({ type: 'assistant.turn_start', timestamp: '2026-10-29T08:00:00.000Z' }) + '\n' + JSON.stringify({ type: 'abort', timestamp: '2026-10-29T08:00:09.000Z' }) + '\n', 'ended')
    const events: Logged[] = []
    watchTab(events, 'ended')
    expect(kinds(events)).toEqual([])
  })

  it('a restored tab whose log turn is still running reports working once', () => {
    writeLog(JSON.stringify({ type: 'assistant.turn_start', timestamp: '2026-10-29T08:01:00.000Z' }) + '\n', 'running')
    const events: Logged[] = []
    watchTab(events, 'running')
    expect(kinds(events)).toEqual([{ kind: 'working' }])
  })

  it('reports the end of a turn Copilot logs as an abort, which no hook reports', async () => {
    fs.mkdirSync(path.dirname(spool), { recursive: true })
    fs.writeFileSync(spool, '{"t":"2026-10-27T19:57:00Z","e":{"hook_event_name":"userPromptSubmitted"}}\n')
    const events: Logged[] = []
    watchTab(events)
    writeLog(fixture('session-log-abort.jsonl').split('\n')[0] + '\n')
    writeLog(fixture('session-log-abort.jsonl').split('\n')[1] + '\n')
    await vi.waitFor(() => expect(kinds(events)).toEqual([{ kind: 'working' }, { kind: 'finished' }]), { timeout: 4000 })
    expect(events.filter((e) => e.event.kind === 'finished')[0].at).toBe(Date.parse('2026-10-27T19:57:09.598Z'))
  })

  it('a log turn started while watching is working, and its end is finished after the next poll', async () => {
    const events: Logged[] = []
    watchTab(events)
    writeLog(JSON.stringify({ type: 'assistant.turn_start', timestamp: '2026-10-29T08:00:00.000Z' }) + '\n')
    await vi.waitFor(() => expect(kinds(events)).toEqual([{ kind: 'working' }]), { timeout: 4000 })
    writeLog(JSON.stringify({ type: 'assistant.turn_end', timestamp: '2026-10-29T08:00:09.000Z' }) + '\n')
    await vi.waitFor(() => expect(kinds(events)).toEqual([{ kind: 'working' }, { kind: 'finished' }]), { timeout: 4000 })
  })

  it('a tab with no records and no log reports nothing', () => {
    const events: Logged[] = []
    watchTab(events)
    expect(kinds(events)).toEqual([])
  })
})
