import { describe, expect, it } from 'vitest'
import type { StatusEvent } from '../../status/contract.ts'
import type { SpoolRecord } from '../../status/spool.ts'
import { emptyFold, stateEvents, step, type CopilotFold } from './normalise.ts'

const NOW = 9000
const T = 5000
// A record as the spool source hands it over: the event name, its time, and the payload with hook_event_name in it.
const r = (event: string, payload: object = {}, at: number | undefined = T): SpoolRecord => ({ event, at, payload: { hook_event_name: event, ...payload } })

function run(records: SpoolRecord[], from: CopilotFold = emptyFold()): { fold: CopilotFold; events: StatusEvent[] } {
  let fold = from
  const events: StatusEvent[] = []
  for (const rec of records) {
    const out = step(fold, rec, NOW)
    fold = out.fold
    events.push(...out.events)
  }
  return { fold, events }
}

const prompt = r('userPromptSubmitted', { prompt: 'make a file' })
const stop = r('agentStop', { stopReason: 'end_turn' })
const perm = r('Notification', { notification_type: 'permission_prompt', message: 'Allow edit?' })
const ask = r('Notification', { notification_type: 'elicitation_dialog', message: 'Pick one' })
const post = r('postToolUse', { cwd: '/w/proj', toolName: 'bash', toolResult: { resultType: 'success' } })
// A subagent's own hooks carry agentId; the root agent's never do
const subOf = (rec: SpoolRecord): SpoolRecord => ({ ...rec, payload: { ...(rec.payload as object), agentId: 'sub-1' } })

describe('copilot step', () => {
  it('a root turn start and end are working then finished; a subagent\'s are ignored', () => {
    expect(run([r('assistant.turn_start'), r('assistant.turn_end')]).events).toEqual([{ kind: 'working' }, { kind: 'finished' }])
    expect(run([subOf(r('assistant.turn_start')), subOf(r('assistant.turn_end'))]).events).toEqual([])
  })

  it('a prompt starts the turn and agentStop ends it; agentStop alone still ends a turn', () => {
    const { fold, events } = run([prompt, stop])
    expect(events).toEqual([{ kind: 'working' }, { kind: 'finished' }])
    expect(fold).toMatchObject({ running: false, startedAt: T })
    expect(run([stop]).events).toEqual([{ kind: 'finished' }])
  })

  it('a tool call with no prompt seen still shows working; a resume sessionStart on a running turn finishes it', () => {
    expect(run([r('preToolUse', { toolName: 'bash' })]).fold.running).toBe(true)
    expect(run([prompt, perm, r('sessionStart', { source: 'resume' })]).events.slice(-1)).toEqual([{ kind: 'finished' }])
    expect(run([r('sessionStart', { source: 'new' })]).events).toEqual([])
  })

  it('only a shown prompt opens attention: a permissionRequest or other notification does not', () => {
    const quiet = [r('permissionRequest', { toolName: 'bash' }), r('notification', { notification_type: 'agent_idle' })]
    expect(run([prompt, ...quiet]).events).toEqual([{ kind: 'working' }])
  })

  it('a shown permission prompt needs you once, and a tool result closes it back to working', () => {
    const { fold, events } = run([prompt, perm, perm, post])
    expect(events).toEqual([{ kind: 'working' }, { kind: 'needs-you', reason: 'permission' }, { kind: 'working' }])
    expect(fold.pending.size).toBe(0)
  })

  it('an elicitation is a question, and its tool result closes it', () => {
    const { fold, events } = run([prompt, ask, post])
    expect(events).toEqual([{ kind: 'working' }, { kind: 'needs-you', reason: 'question' }, { kind: 'working' }])
    expect(fold.pending.size).toBe(0)
  })

  it('a denied request (no tool result) closes at the end of the turn, a new prompt or a session start', () => {
    expect(run([prompt, perm, r('preToolUse', { toolName: 'bash' })]).fold.pending.size).toBe(1)
    for (const next of [stop, prompt, r('sessionStart', { source: 'resume' })]) {
      expect(run([prompt, perm, next]).fold.pending.size).toBe(0)
    }
  })

  it('a subagent\'s prompt, tool calls and stop never start or end the turn; its shown prompt still needs you', () => {
    const turn = run([prompt, r('preToolUse', { toolName: 'task' }), subOf(prompt), subOf(r('preToolUse', { toolName: 'bash' })), subOf(post), subOf(stop)])
    expect(turn.events).toEqual([{ kind: 'working' }])
    expect(turn.fold.running).toBe(true)
    expect(run([post, stop], turn.fold).events).toEqual([{ kind: 'finished' }])
    // a background subagent still working after the turn ended leaves the tab done
    const done = run([prompt, stop, subOf(prompt), subOf(r('preToolUse', { toolName: 'bash' })), subOf(stop)])
    expect(done.events).toEqual([{ kind: 'working' }, { kind: 'finished' }])
    expect(run([prompt, subOf(perm)]).events).toEqual([{ kind: 'working' }, { kind: 'needs-you', reason: 'permission' }])
  })

  it('an abort or shutdown from the log ends a running turn, unless it is older than the turn', () => {
    const started = run([r('userPromptSubmitted', {}, 1000)]).fold
    for (const type of ['abort', 'session.shutdown']) {
      const { fold, events } = run([r(type, {}, 2000)], started)
      expect(events).toEqual([{ kind: 'finished' }])
      expect(fold).toMatchObject({ running: false })
    }
    expect(run([r('abort', {}, 999)], started).fold.running).toBe(true)
    expect(run([r('abort', {}, 2000)]).events).toEqual([])
  })

  it('an abort closes an open prompt, then ends the turn', () => {
    const { fold, events } = run([prompt, perm, r('abort', {}, T + 1)])
    expect(events.slice(-2)).toEqual([{ kind: 'working' }, { kind: 'finished' }])
    expect(fold.pending.size).toBe(0)
  })

  it('a record with no time uses the clock for the turn start', () => {
    const untimed: SpoolRecord = { event: 'userPromptSubmitted', at: undefined, payload: { hook_event_name: 'userPromptSubmitted' } }
    expect(step(emptyFold(), untimed, NOW).fold.startedAt).toBe(NOW)
  })

  it('an unknown or malformed record changes nothing', () => {
    const f = emptyFold()
    expect(step(f, r('sessionEnd'), NOW)).toEqual({ fold: f, events: [] })
    expect(step(f, r('some.other.event'), NOW)).toEqual({ fold: f, events: [] })
  })

  it('a state read from the fold names what it is doing now, and nothing when idle', () => {
    expect(stateEvents(emptyFold())).toEqual([])
    expect(stateEvents(run([prompt]).fold)).toEqual([{ kind: 'working' }])
    expect(stateEvents(run([prompt, ask]).fold)).toEqual([{ kind: 'needs-you', reason: 'question' }])
    expect(stateEvents(run([prompt, stop]).fold)).toEqual([])
  })
})
