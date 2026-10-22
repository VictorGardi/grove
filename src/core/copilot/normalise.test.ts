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
const perm = { hook_event_name: 'permissionRequest', hookName: 'permissionRequest', toolName: 'edit', toolInput: { file_path: `${CWD}/a.txt` } }
const patch = (body: string) => `*** Begin Patch\n${body}\n*** End Patch\n`
const post = (over: object) => ({ hook_event_name: 'postToolUse', cwd: CWD, toolResult: { resultType: 'success', textResultForLlm: 'Added 1 file(s)' }, ...over })
const stop = { hook_event_name: 'agentStop', stopReason: 'end_turn' }

describe('copilot step', () => {
  it('a prompt starts the turn and agentStop ends it', () => {
    const { fold, events } = run([r(prompt), r(stop)])
    expect(events).toEqual([{ type: 'exec-started', sessionId: 'S' }, { type: 'exec-ended', sessionId: 'S', at: AT }])
    expect(fold).toMatchObject({ running: false, idleAt: AT })
  })

  it('agentStop ends a turn even when its prompt was never seen', () => {
    expect(run([r(stop)]).events).toEqual([{ type: 'exec-ended', sessionId: 'S', at: AT }])
  })

  it('a permission request opens attention once, and a tool result closes it', () => {
    const { fold, events } = run([r(prompt), r(perm), r(perm), r(post({ toolName: 'bash', toolArgs: { command: 'ls' } }))])
    expect(events.filter((e) => e.type === 'pending')).toEqual([
      { type: 'pending', sessionId: 'S', id: 'perm:main', kind: 'permission', open: true },
      { type: 'pending', sessionId: 'S', id: 'perm:main', kind: 'permission', open: false },
    ])
    expect(fold.pending.size).toBe(0)
  })

  it('a denied request (no tool result) closes at the end of the turn, a new prompt or a new session start; a parallel tool call does not close it', () => {
    expect(run([r(prompt), r(perm), r({ hook_event_name: 'preToolUse', toolName: 'bash' })]).fold.pending.size).toBe(1)
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
})
