import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../agents/types'
import type { SpoolRecord } from '../claude/spool'
import { emptyFold, step, type CopilotFold } from './normalise'

const T = '2026-10-22T10:17:30Z'
const AT = '2026-10-22T10:17:30.000Z'
const r = (e: object, t = T): SpoolRecord => ({ t, e })

function run(records: SpoolRecord[], from: CopilotFold = emptyFold('S')): { fold: CopilotFold; events: AgentEvent[] } {
  let fold = from
  const events: AgentEvent[] = []
  for (const rec of records) {
    const out = step(fold, rec)
    fold = out.fold
    events.push(...out.events)
  }
  return { fold, events }
}

const CWD = '/w/proj'
// Shapes captured from copilot 1.0.102 (-p runs); the event name is the one the hook command stamps in.
const prompt = { hook_event_name: 'userPromptSubmitted', sessionId: 'x', prompt: 'make a file' }
// A notification payload carries its own hook_event_name, which wins over the stamped one (verified on 1.0.103)
const perm = { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Allow edit?' }
const ask = { hook_event_name: 'Notification', notification_type: 'elicitation_dialog', message: 'Pick one' }
const pre = (toolName: string) => ({ hook_event_name: 'preToolUse', toolName, toolArgs: {} })
// A subagent's own hooks, as captured on 1.0.103: they carry agentId, the root agent's never do
const subOf = (e: object) => ({ ...e, sessionId: 'sub-1', agentId: 'sub-1', agentType: 'task', parentAgentId: 'S' })
const patch = (body: string) => `*** Begin Patch\n${body}\n*** End Patch\n`
const post = (over: object) => ({ hook_event_name: 'postToolUse', cwd: CWD, toolResult: { resultType: 'success', textResultForLlm: 'Added 1 file(s)' }, ...over })
const stop = { hook_event_name: 'agentStop', stopReason: 'end_turn' }

describe('copilot step', () => {
  it('uses native root turn boundaries when they are available', () => {
    const { fold, events } = run([r({ hook_event_name: 'assistant.turn_start' }), r({ hook_event_name: 'assistant.turn_end' })])
    expect(events).toEqual([
      { type: 'exec-started', sessionId: 'S' },
      { type: 'exec-ended', sessionId: 'S', at: AT },
    ])
    expect(fold).toMatchObject({ running: false, idleAt: AT })
    expect(run([r(subOf({ hook_event_name: 'assistant.turn_start' })), r(subOf({ hook_event_name: 'assistant.turn_end' }))]).events).toEqual([])
  })

  it('a prompt starts the turn and agentStop ends it', () => {
    const { fold, events } = run([r(prompt), r(stop)])
    expect(events).toEqual([{ type: 'exec-started', sessionId: 'S' }, { type: 'exec-ended', sessionId: 'S', at: AT }])
    expect(fold).toMatchObject({ running: false, idleAt: AT })
  })

  it('agentStop ends a turn even when its prompt was never seen', () => {
    expect(run([r(stop)]).events).toEqual([{ type: 'exec-ended', sessionId: 'S', at: AT }])
  })

  it('only a shown prompt opens attention: a permissionRequest or other notification does not', () => {
    const quiet = [{ hook_event_name: 'permissionRequest', toolName: 'bash' }, { hook_event_name: 'notification', notification_type: 'agent_idle' }]
    expect(run([r(prompt), ...quiet.map((q) => r(q))]).events.map((e) => e.type)).toEqual(['exec-started'])
  })

  it('an elicitation is a question, and its tool result closes it', () => {
    const { fold, events } = run([r(prompt), r(ask), r(post({ toolName: 'ask_user', toolArgs: {} }))])
    expect(events.filter((e) => e.type === 'pending')).toEqual([
      { type: 'pending', sessionId: 'S', id: 'q:main', kind: 'question', open: true },
      { type: 'pending', sessionId: 'S', id: 'q:main', kind: 'question', open: false },
    ])
    expect(fold.pending.size).toBe(0)
  })

  it('a subagent\'s prompt, tool calls and stop never start or end the turn', () => {
    const turn = run([r(prompt), r(pre('task')), r(subOf(prompt)), r(subOf(pre('bash'))), r(subOf(post({ toolName: 'bash' }))), r(subOf(stop))])
    expect(turn.events.map((e) => e.type)).toEqual(['exec-started'])
    expect(turn.fold.running).toBe(true)
    expect(run([r(post({ toolName: 'task' })), r(stop)], turn.fold).events.map((e) => e.type)).toEqual(['exec-ended'])
    // a background subagent still working after the turn ended leaves the card done
    const done = run([r(prompt), r(stop), r(subOf(prompt)), r(subOf(pre('bash'))), r(subOf(stop))])
    expect(done.events.map((e) => e.type)).toEqual(['exec-started', 'exec-ended'])
  })

  it('a subagent\'s shown permission prompt still opens attention, and its write is still linked', () => {
    const { events } = run([r(prompt), r(subOf(perm)), r(subOf(post({ toolName: 'apply_patch', toolArgs: patch('*** Add File: s.txt') })))])
    expect(events.map((e) => e.type)).toEqual(['exec-started', 'pending', 'pending', 'wrote'])
  })

  it('an abort or shutdown from the session log ends a running turn, unless it is older than the turn', () => {
    const t0 = 1793131008419
    const started = run([r({ ...prompt, timestamp: t0 })]).fold
    for (const type of ['abort', 'session.shutdown']) {
      const { fold, events } = run([r(perm), r({ hook_event_name: type }, '2026-10-27T19:57:09.598Z')], started)
      expect(events.map((e) => e.type)).toEqual(['pending', 'pending', 'exec-ended'])
      expect(fold).toMatchObject({ running: false, idleAt: '2026-10-27T19:57:09.598Z' })
    }
    const stale = new Date(t0 - 1).toISOString()
    expect(run([r({ hook_event_name: 'abort' }, stale)], started).fold.running).toBe(true)
    expect(run([r({ hook_event_name: 'abort' })]).events).toEqual([])
  })

  it('the turn ends at Copilot\'s own millisecond timestamp when the payload has one', () => {
    expect(run([r(prompt), r({ ...stop, timestamp: 1792698805842 })]).fold.idleAt).toBe(new Date(1792698805842).toISOString())
  })

  it('a permission prompt opens attention once, and a tool result closes it', () => {
    const { fold, events } = run([r(prompt), r(perm), r(perm), r(post({ toolName: 'bash', toolArgs: { command: 'ls' } }))])
    expect(events.filter((e) => e.type === 'pending')).toEqual([
      { type: 'pending', sessionId: 'S', id: 'perm:main', kind: 'permission', open: true },
      { type: 'pending', sessionId: 'S', id: 'perm:main', kind: 'permission', open: false },
    ])
    expect(fold.pending.size).toBe(0)
  })

  it('a denied request (no tool result) closes at the end of the turn, a new prompt or a new session start; a parallel tool call does not close it', () => {
    expect(run([r(prompt), r(perm), r(pre('bash'))]).fold.pending.size).toBe(1)
    for (const next of [stop, prompt, { hook_event_name: 'sessionStart', source: 'resume' }]) {
      const { fold } = run([r(prompt), r(perm), r(next)])
      expect(fold.pending.size).toBe(0)
    }
  })

  it('a successful apply_patch is a write, one path per file, relative to the hook cwd', () => {
    const toolArgs = patch('*** Add File: a.txt\n+hi\n*** Update File: src/b.ts\n@@\n-x\n+y\n*** Delete File: gone.txt')
    const { fold, events } = run([r(post({ toolName: 'apply_patch', toolArgs }))])
    expect(events).toEqual([{ type: 'wrote', sessionId: 'S', paths: [`${CWD}/a.txt`, `${CWD}/src/b.ts`] }])
    expect(fold.lastWrite).toEqual([`${CWD}/a.txt`, `${CWD}/src/b.ts`])
  })

  it('a failed or non-write tool is no write, and a later success replaces the last write', () => {
    const toolArgs = patch('*** Add File: a.txt\n+hi')
    expect(run([r(post({ toolName: 'apply_patch', toolArgs, toolResult: { resultType: 'failure' } }))]).events).toEqual([])
    expect(run([r(post({ toolName: 'bash', toolArgs: { command: 'echo hi > a.txt' } }))]).events).toEqual([])
    const { fold } = run([r(post({ toolName: 'apply_patch', toolArgs })), r(post({ toolName: 'apply_patch', toolArgs: patch('*** Update File: /abs/c.ts') }))])
    expect(fold.lastWrite).toEqual(['/abs/c.ts'])
  })

  it('edit and create with a path argument are writes (shape not verified against a real run); other shapes are not', () => {
    expect(run([r(post({ toolName: 'edit', toolArgs: { path: `${CWD}/e.ts` } }))]).fold.lastWrite).toEqual([`${CWD}/e.ts`])
    expect(run([r(post({ toolName: 'create', toolArgs: { file_path: 'n.ts' } }))]).fold.lastWrite).toEqual([`${CWD}/n.ts`])
    expect(run([r(post({ toolName: 'edit', toolArgs: 'text' }))]).events).toEqual([])
  })

  it('a tool call with no prompt seen still shows working, and a resume start clears a stale turn', () => {
    expect(run([r({ hook_event_name: 'preToolUse', toolName: 'bash' })]).fold.running).toBe(true)
    expect(run([r(prompt), r(perm), r({ hook_event_name: 'sessionStart' })]).fold).toMatchObject({ running: false, idleAt: AT })
  })

  it('a JSON-string toolArgs is read, and a relative path with no cwd is dropped, never emitted relative', () => {
    expect(run([r(post({ toolName: 'edit', toolArgs: '{"path":"/w/x.ts"}' }))]).fold.lastWrite).toEqual(['/w/x.ts'])
    expect(run([r(post({ toolName: 'edit', toolArgs: '{"path":"x.ts"}', cwd: undefined }))]).events).toEqual([])
    expect(run([r(post({ toolName: 'apply_patch', toolArgs: patch('*** Update File: a.ts\n*** Move to: b.ts'), cwd: undefined }))]).events).toEqual([])
    expect(run([r(post({ toolName: 'apply_patch', toolArgs: patch('*** Update File: a.ts\n*** Move to: b.ts') }))]).fold.lastWrite).toEqual([`${CWD}/a.ts`, `${CWD}/b.ts`])
  })

  it('sessionEnd ends a running turn only, and unknown or malformed records change nothing', () => {
    expect(run([r(prompt), r({ hook_event_name: 'sessionEnd', reason: 'complete' })]).events.map((e) => e.type)).toEqual(['exec-started', 'exec-ended'])
    expect(run([r({ hook_event_name: 'sessionEnd' })]).events).toEqual([])
    const f = emptyFold('S')
    expect(step(f, r({ hook_event_name: 'sessionStart', source: 'new' })).fold).toBe(f)
    expect(step(f, { t: T, e: 'x' }).fold).toBe(f)
  })

  describe('context', () => {
    const usage = (inputTokens: number, over: object = {}) => ({ hook_event_name: 'session.usage_record', usage: { model: 'gpt-6-luna', inputTokens, outputTokens: 39, maxPromptTokens: 272000 }, ...over })

    it('a root usage record is a reading of the prompt against its budget; an unchanged one is not repeated', () => {
      const { fold, events } = run([r(usage(27200)), r(usage(27200))])
      const context = { pct: 10, tokens: 27200, window: 272000, model: 'gpt-6-luna' }
      expect(events).toEqual([{ type: 'context', sessionId: 'S', context }])
      expect(fold.context).toEqual(context)
    })

    it('ignores a subagent\'s usage, and a record without a budget has no percentage', () => {
      expect(run([r(usage(1000, { agentId: 'sub-1' }))]).events).toEqual([])
      expect(run([r({ hook_event_name: 'session.usage_record', usage: { inputTokens: 5 } })]).fold.context).toEqual({ pct: null, tokens: 5, window: null, model: null })
    })
  })
})
