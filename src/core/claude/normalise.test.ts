import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../agents/types'
import { emptyFold, step, type ClaudeFold } from './normalise'
import { scanRecords, type SpoolRecord } from './spool'

const T = '2026-10-07T06:35:03Z'
const AT = '2026-10-07T06:35:03.000Z'
const r = (e: unknown, t = T): SpoolRecord => ({ t, e })

function run(records: SpoolRecord[], from: ClaudeFold = emptyFold('S')): { fold: ClaudeFold; events: AgentEvent[] } {
  let fold = from
  const events: AgentEvent[] = []
  for (const rec of records) {
    const out = step(fold, rec)
    fold = out.fold
    events.push(...out.events)
  }
  return { fold, events }
}

const open = (id: string, kind: 'permission' | 'question'): AgentEvent => ({ type: 'pending', sessionId: 'S', id, kind, open: true })
const close = (id: string, kind: 'permission' | 'question'): AgentEvent => ({ type: 'pending', sessionId: 'S', id, kind, open: false })
const started: AgentEvent = { type: 'exec-started', sessionId: 'S' }
const ended = (at = AT): AgentEvent => ({ type: 'exec-ended', sessionId: 'S', at })

const perm = (over = {}) => ({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', ...over })
const ask = (id = 'tu1') => ({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: id })
const waiting = run([r(perm()), r(ask('x'))]).fold // perm:main and q:x open

describe('step', () => {
  it('UserPromptSubmit closes pending of all scopes, then starts a turn', () => {
    const { fold, events } = run([r({ hook_event_name: 'UserPromptSubmit' })], waiting)
    expect(events).toEqual([close('perm:main', 'permission'), close('q:x', 'question'), started])
    expect(fold).toMatchObject({ running: true, pending: new Map() })
  })

  it('PermissionRequest opens a permission per scope, but not for AskUserQuestion', () => {
    expect(run([r(perm())]).events).toEqual([open('perm:main', 'permission')])
    expect(run([r(perm({ agent_id: 'a1' }))]).events).toEqual([open('perm:a1', 'permission')])
    const before = emptyFold('S')
    const out = step(before, r(perm({ tool_name: 'AskUserQuestion' })))
    expect(out).toEqual({ fold: before, events: [] })
  })

  it('PreToolUse AskUserQuestion opens a question', () => {
    expect(run([r(ask())]).events).toEqual([open('q:tu1', 'question')])
  })

  it('PostToolUse and PostToolUseFailure close the scope permission and the question', () => {
    for (const hook_event_name of ['PostToolUse', 'PostToolUseFailure']) {
      const { fold, events } = run([r({ hook_event_name, tool_name: 'AskUserQuestion', tool_use_id: 'x' })], waiting)
      expect(events).toEqual([close('perm:main', 'permission'), close('q:x', 'question')])
      expect(fold.pending.size).toBe(0)
    }
  })

  it('PostToolUse of a write tool reports its path, from any scope', () => {
    const wrote = (p: string): AgentEvent => ({ type: 'wrote', sessionId: 'S', paths: [p] })
    for (const tool_name of ['Write', 'Edit', 'MultiEdit']) {
      const { fold, events } = run([r({ hook_event_name: 'PostToolUse', tool_name, tool_use_id: 'y', tool_input: { file_path: '/a' } })])
      expect(events).toEqual([wrote('/a')])
      expect(fold.lastWrite).toEqual(['/a'])
    }
    expect(run([r({ hook_event_name: 'PostToolUse', tool_name: 'NotebookEdit', tool_input: { notebook_path: '/n.ipynb' } })]).events).toEqual([wrote('/n.ipynb')])
    expect(run([r({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_id: 'a1', tool_input: { file_path: '/a' } })]).events).toEqual([wrote('/a')])
    expect(run([r({ hook_event_name: 'PostToolUseFailure', tool_name: 'Write', tool_input: { file_path: '/a' } })]).events).toEqual([])
    expect(run([r({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { file_path: '/a' } })]).events).toEqual([])
    expect(run([r({ hook_event_name: 'PostToolUse', tool_name: 'Write' })]).events).toEqual([])
    expect(emptyFold('S').lastWrite).toEqual([])
  })

  it('PostToolBatch closes permissions of all scopes, keeping questions', () => {
    const from = run([r(perm()), r(perm({ agent_id: 'a1' })), r(ask())]).fold
    const { fold, events } = run([r({ hook_event_name: 'PostToolBatch' })], from)
    expect(events).toEqual([close('perm:main', 'permission'), close('perm:a1', 'permission')])
    expect([...fold.pending]).toEqual([['q:tu1', 'question']])
  })

  it('Stop and StopFailure of the main scope close everything and end the turn', () => {
    for (const hook_event_name of ['Stop', 'StopFailure']) {
      const { fold, events } = run([r({ hook_event_name })], waiting)
      expect(events).toEqual([close('perm:main', 'permission'), close('q:x', 'question'), ended()])
      expect(fold).toMatchObject({ running: false, idleAt: AT })
      expect(run([r({ hook_event_name, agent_id: 'a1' })], waiting).events).toEqual([])
    }
  })

  it('Notification closes everything and ends a running turn only', () => {
    const note = r({ hook_event_name: 'Notification', notification_type: 'idle_prompt' })
    expect(run([note], waiting).events).toEqual([close('perm:main', 'permission'), close('q:x', 'question')])
    const running = run([r({ hook_event_name: 'UserPromptSubmit' })]).fold
    expect(run([note], running).events).toEqual([ended()])
  })

  it('an Esc-rejected question (no hook) is closed by idle_prompt', () => {
    const { fold, events } = run([
      r({ hook_event_name: 'UserPromptSubmit' }),
      r(ask()),
      r({ hook_event_name: 'Notification', notification_type: 'idle_prompt' }, '2026-10-07T06:36:03Z'),
    ])
    expect(events).toEqual([started, open('q:tu1', 'question'), close('q:tu1', 'question'), ended('2026-10-07T06:36:03.000Z')])
    expect(fold).toMatchObject({ running: false, pending: new Map() })
  })

  it('ignores SessionStart, unknown hooks and non-object payloads, never mutating the fold', () => {
    const before = emptyFold('S')
    for (const e of [{ hook_event_name: 'SessionStart', session_id: 'x' }, { hook_event_name: 'Nope' }, 1, null]) {
      expect(step(before, r(e))).toEqual({ fold: before, events: [] })
    }
    const copy = new Map(waiting.pending)
    step(waiting, r({ hook_event_name: 'Stop' }))
    expect(waiting.pending).toEqual(copy)
  })
})

// Compact form: "start", "end HH:MM:SS", "+id", "-id" (question ids carry their kind via q:).
const short = (e: AgentEvent) => e.type === 'exec-started' ? 'start'
  : e.type === 'exec-ended' ? `end ${e.at.slice(11, 19)}`
  : e.type === 'wrote' ? `wrote ${path.basename(e.paths[0])}`
  : e.type === 'pending' ? `${e.open ? '+' : '-'}${e.id}${e.kind === 'permission' && !e.id.startsWith('perm:') ? '!' : ''}`
  : e.type

function replay(fixture: string): { fold: ClaudeFold; events: AgentEvent[] } {
  const text = fs.readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url), 'utf8')
  return run(scanRecords(text).records)
}

describe('fixture replay', () => {
  it('capture-2.1.285: turns, and a rejected question shown as a question, closed by the next prompt', () => {
    const { fold, events } = replay('capture-2.1.285.jsonl')
    expect(events.map(short)).toEqual([
      'start', 'end 06:35:03', 'start', 'end 06:35:16', 'start', 'wrote say_hej.sh', 'end 06:35:59', 'start',
      '+q:toolu_01QTKr2HMANZKPADarYMkipa', '-q:toolu_01QTKr2HMANZKPADarYMkipa', 'start', 'wrote needs_perms.sh', 'end 06:37:57',
      'start', 'end 06:38:12',
    ])
    expect(events.some((e) => e.type === 'pending' && e.kind === 'permission')).toBe(false)
    expect(fold).toMatchObject({ running: false, idleAt: '2026-10-07T06:38:12.000Z', pending: new Map(),
      lastWrite: ['/private/tmp/claude-501/-Users-victor-git-grove/4049dd18-706b-47d5-8458-0b22ffd98930/scratchpad/needs_perms.sh'] })
  })

  it('capture-2.1.285-b: permissions, an answered question, an interrupt, Edits and a background subagent', () => {
    const { fold, events } = replay('capture-2.1.285-b.jsonl')
    expect(events.map(short)).toEqual([
      'start', 'end 07:27:10', 'start', 'end 07:27:38', 'start', 'end 07:28:36', 'start', 'end 07:29:36',
      'start', '+perm:main', '-perm:main', 'end 07:30:05', // Bash approved after 16 s; closed by its batch
      'start', '+q:toolu_019chusa7jvh2gwUUZkRaqbc', '-q:toolu_019chusa7jvh2gwUUZkRaqbc', 'end 07:30:55', // answered
      'start', '+perm:main', '-perm:main', 'end 07:31:10',
      'start', 'start', // Esc: no Stop; the next prompt starts over
      'start', '+perm:main', '-perm:main', 'wrote CONTEXT.md', '+perm:main', '-perm:main', 'wrote CONTEXT.md', '+perm:main', '-perm:main', 'end 07:32:02', // Edit, Edit, Bash
      'start', 'end 07:32:12',
      '+perm:ac0b2a4dd439f0325', '-perm:ac0b2a4dd439f0325', 'start', 'end 07:32:19', // background subagent after the main Stop
    ])
    expect(events.filter((e) => e.type === 'pending' && e.kind === 'question')).toHaveLength(2)
    expect(fold).toMatchObject({ running: false, idleAt: '2026-10-07T07:32:19.000Z', pending: new Map(), lastWrite: ['/Users/victor/git/grove/CONTEXT.md'] })
  })
})
