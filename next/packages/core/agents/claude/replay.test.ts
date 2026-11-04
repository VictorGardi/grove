import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyEvent, GRACE_MS, SILENCE_MS, unknownStatus, type Status, type StatusEvent } from '../../status/contract.ts'
import { createCrossCheck } from '../../status/cross-check.ts'
import { StatusService } from '../../status/service.ts'
import { createClaudeSource } from './source.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) => path.join(here, 'fixtures', name)

// The first record's time in every fixture.
const START = 1793750400000
const SESSION = '00000000-0000-4000-8000-00000000000b'

interface Step {
  event: StatusEvent
  at: number
  status: Status
}

// Replays a fixture's first `lines` records (all when omitted) through the source and the reducer.
// Returns each delivered event with the status after it, and the labels of the status-changing steps.
function replay(name: string, lines?: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-claude-replay-'))
  try {
    const spool = path.join(dir, 'tab.jsonl')
    const all = fs.readFileSync(fixture(name), 'utf8').split('\n').filter((line) => line !== '')
    fs.writeFileSync(spool, all.slice(0, lines ?? all.length).join('\n') + '\n')
    const steps: Step[] = []
    let status: Status = unknownStatus(0)
    const source = createClaudeSource({
      spoolFile: spool,
      offsetFile: path.join(dir, 'tab.offset'),
      clock: () => 0,
      onEvent: (event, at) => {
        status = applyEvent(status, event, at)
        steps.push({ event, at, status })
      },
    })
    source.close()
    const labels = steps
      .filter((step) => step.event.kind !== 'heartbeat' && step.event.kind !== 'session')
      .map((step) => (step.status.state === 'needs-you' ? `needs-you:${step.status.reason}` : step.status.state))
    return { steps, labels, status }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// Plays a fixture's first `lines` records through the real StatusService and the real Claude source, the way
// production runs them. The source replays the spool when the tab is tracked. After that, each second brings the
// poll's heartbeat and then the service's tick, and `screen` is what the holder shows on each tick.
function serviceOn(name: string, lines: number | undefined, screen: () => string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-claude-service-'))
  const spool = path.join(dir, 'tab.jsonl')
  const all = fs.readFileSync(fixture(name), 'utf8').split('\n').filter((line) => line !== '')
  fs.writeFileSync(spool, all.slice(0, lines ?? all.length).join('\n') + '\n')
  let now = START
  let heartbeat: ((event: StatusEvent, at: number) => void) | undefined
  const service = new StatusService({
    home: dir,
    launchClaude: () => {
      throw new Error('not used: the tab is tracked directly')
    },
    createSource: (options) => {
      heartbeat = options.onEvent
      return createClaudeSource(options)
    },
    screen: async () => screen(),
    alive: async () => new Set(['tab']),
    clock: () => now,
    graceMs: GRACE_MS,
    silenceMs: SILENCE_MS,
  })
  service.track({ tabId: 'tab', spacePath: dir, spoolFile: spool, sessionId: SESSION })
  return {
    state: () => service.list(new Set(['tab']))[0],
    setNow: (at: number) => (now = at),
    async run(seconds: number) {
      for (let i = 0; i < seconds; i++) {
        now += 1000
        heartbeat!({ kind: 'heartbeat' }, now)
        await service.tick()
      }
    },
    close: () => {
      service.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

describe('replay of the synthetic Claude fixtures', () => {
  it('(a) a permission ask, answered: needs-you, then working again, then finished', () => {
    expect(replay('a-permission-answered.jsonl').labels).toEqual([
      'working',
      'working',
      'needs-you:permission',
      'working',
      'working',
      'finished',
    ])
  })

  it('(b) an interrupted turn: stays working with no end record, then the next prompt runs to finished', () => {
    const result = replay('b-interrupted-turn.jsonl')
    expect(result.labels).toEqual(['working', 'working', 'working', 'working', 'working', 'finished'])
    expect(result.status).toEqual({ state: 'finished', since: 1793750460600 })
  })

  it('(b) an interrupted turn with no next prompt falls to unknown once the screen and spool stay quiet', async () => {
    // Records 1 to 3: prompt, PreToolUse, then the Esc that fires nothing. The screen never changes.
    const { steps } = replay('b-interrupted-turn.jsonl', 3)
    const last = steps[steps.length - 1]
    expect(last.status).toEqual({ state: 'working', since: 1793750401000 })
    const tab = serviceOn('b-interrupted-turn.jsonl', 3, () => 'Running npm run build')
    try {
      tab.setNow(last.at)
      await tab.run(SILENCE_MS / 1000 - 1)
      expect(tab.state()).toMatchObject({ state: 'working', since: 1793750401000 })
      await tab.run(1)
      expect(tab.state()).toMatchObject({ state: 'unknown', since: last.at + SILENCE_MS })
    } finally {
      tab.close()
    }
  })

  it('(b) an interrupted turn whose spinner and timer keep moving falls to unknown too', async () => {
    let seconds = 0
    const tab = serviceOn('b-interrupted-turn.jsonl', 3, () => `⠋ Running npm run build (${seconds++}s)`)
    try {
      tab.setNow(START + 1200)
      await tab.run(SILENCE_MS / 1000 + 1)
      expect(tab.state()).toMatchObject({ state: 'unknown' })
    } finally {
      tab.close()
    }
  })

  it('(b) a working turn whose screen keeps changing in real text stays working', async () => {
    let step = 0
    const tab = serviceOn('b-interrupted-turn.jsonl', 3, () => `Running step ${step++}`)
    try {
      tab.setNow(START + 1200)
      await tab.run((SILENCE_MS * 2) / 1000)
      expect(tab.state()).toMatchObject({ state: 'working', since: START + 1000 })
    } finally {
      tab.close()
    }
  })

  it('(c) an Esc-rejected question: needs-you question, and the stream goes quiet', () => {
    const { labels, status, steps } = replay('c-esc-rejected-question.jsonl')
    // The question starts at PreToolUse of AskUserQuestion; the elicitation notification repeats the reason and keeps its time.
    expect(labels).toEqual(['working', 'needs-you:question', 'needs-you:question'])
    expect(status).toEqual({ state: 'needs-you', reason: 'question', since: 1793750401200 })
    expect(steps[steps.length - 1].at).toBe(1793750401300)
  })

  it('(c) an Esc-rejected question falls to unknown through the cross-check once the screen changes', () => {
    const { status } = replay('c-esc-rejected-question.jsonl')
    const before = fs.readFileSync(fixture('c-esc-rejected-question.before.txt'), 'utf8')
    const after = fs.readFileSync(fixture('c-esc-rejected-question.after.txt'), 'utf8')
    let now = status.since
    const cross = createCrossCheck({ clock: () => now })
    cross.observe(status)
    // The first screen after the needs-you is the baseline.
    expect(cross.check(before)).toBeNull()

    now = status.since + GRACE_MS
    expect(cross.check(before)).toBeNull()

    // The dialog is gone after Esc and the screen is quiet again; the change alone is what counts.
    now += 5000
    expect(cross.check(after)).toEqual({ state: 'unknown', since: now })
  })

  it('(c) the cross-check holds needs-you while the screen is unchanged', () => {
    const { status } = replay('c-esc-rejected-question.jsonl')
    const before = fs.readFileSync(fixture('c-esc-rejected-question.before.txt'), 'utf8')
    let now = status.since + GRACE_MS
    const cross = createCrossCheck({ clock: () => now })
    cross.observe(status)
    expect(cross.check(before)).toBeNull()
    now += 5000
    expect(cross.check(before)).toBeNull()
  })

  it('(d) a turn woken by a background task: working with no prompt, then finished', () => {
    const result = replay('d-background-task-turn.jsonl')
    expect(result.labels).toEqual(['working', 'working', 'finished'])
    expect(result.steps[0].event).toEqual({ kind: 'session', resumeId: '00000000-0000-4000-8000-00000000000d' })
  })

  it('(d) a silent working turn (first two records only) falls to unknown once nothing real happens', async () => {
    const tab = serviceOn('d-background-task-turn.jsonl', 2, () => 'Reading build-output.log')
    try {
      tab.setNow(START + 2000)
      await tab.run(SILENCE_MS)
      expect(tab.state()).toMatchObject({ state: 'unknown', since: START + 2000 + SILENCE_MS })
    } finally {
      tab.close()
    }
  })
})
