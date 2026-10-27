import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CopilotEventLog } from './events'

describe('CopilotEventLog', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-copilot-home-'))
  const file = (id: string) => path.join(home, 'session-state', id, 'events.jsonl')
  const line = (o: object) => JSON.stringify(o) + '\n'
  // shapes as Copilot 1.0.103 writes them
  const abort = { type: 'abort', data: { reason: 'user_abort' }, id: 'a', timestamp: '2026-10-27T19:57:09.598Z', parentId: 'p' }
  const shutdown = { type: 'session.shutdown', data: { shutdownType: 'routine' }, id: 'b', timestamp: '2026-10-27T19:57:22.509Z', parentId: 'a' }

  it('reads root-agent abort and shutdown records once each, skipping other types and a subagent\'s', () => {
    const log = new CopilotEventLog(home)
    expect(log.read('none')).toEqual([])
    fs.mkdirSync(path.dirname(file('s')), { recursive: true })
    fs.writeFileSync(file('s'), line({ type: 'assistant.turn_end', data: { turnId: '0' }, timestamp: 'x' }) + line({ ...abort, agentId: 'sub' }) + line(abort))
    expect(log.read('s')).toEqual([{ t: abort.timestamp, e: { hook_event_name: 'abort' } }])
    expect(log.read('s')).toEqual([])
    fs.appendFileSync(file('s'), line(shutdown).slice(0, 20)) // a line still being written waits
    expect(log.read('s')).toEqual([])
    fs.appendFileSync(file('s'), line(shutdown).slice(20))
    expect(log.read('s')).toEqual([{ t: shutdown.timestamp, e: { hook_event_name: 'session.shutdown' } }])
  })

  it('reads root-agent usage records with their usage, skipping a subagent\'s', () => {
    const log = new CopilotEventLog(home)
    const usage = { model: 'gpt-6-luna', inputTokens: 16159, outputTokens: 39, maxPromptTokens: 272000, parentToolCallId: null }
    const rec = { type: 'session.usage_record', agentId: null, data: { usage }, id: 'c', timestamp: '2026-10-27T19:55:42.884Z' }
    fs.mkdirSync(path.dirname(file('u')), { recursive: true })
    fs.writeFileSync(file('u'), line({ ...rec, agentId: 'sub' }) + line(rec))
    expect(log.read('u')).toEqual([{ t: rec.timestamp, e: { hook_event_name: 'session.usage_record', usage } }])
  })

  it('a first read of a large log starts near its end, and forget starts over', () => {
    const log = new CopilotEventLog(home)
    fs.mkdirSync(path.dirname(file('big')), { recursive: true })
    fs.writeFileSync(file('big'), line(abort) + line({ type: 'model.messages_snapshot', data: 'x'.repeat(1 << 20), timestamp: 'x' }) + line(shutdown))
    expect(log.read('big').map((r) => r.e)).toEqual([{ hook_event_name: 'session.shutdown' }])
    log.forget('big')
    expect(log.read('big').map((r) => r.e)).toEqual([{ hook_event_name: 'session.shutdown' }])
  })
})
