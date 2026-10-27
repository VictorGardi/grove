import fs from 'node:fs'
import path from 'node:path'
import type { SpoolRecord } from '../claude/spool'

const TYPES = new Set(['abort', 'session.shutdown', 'session.usage_record'])
const FIRST_READ_MAX = 1 << 20

// The turn ends no hook reports, read from Copilot's own session log <home>/session-state/<id>/events.jsonl (one JSON
// object per line; an internal format, verified on 1.0.103). An interrupted turn (Esc) fires no hook but logs
// {"type":"abort"}; `session.shutdown` backs up a sessionEnd hook that failed to spawn. Tailed by byte offset; a first read
// starts at most 1 MiB before the end, as the log also carries whole model snapshots.
// `session.usage_record` (one per model call, written just before the turn ends) carries the prompt size and budget: the
// context gauge. A subagent's records name it in `agentId`; the root agent's have it null or missing.
export class CopilotEventLog {
  private offsets = new Map<string, number>()

  constructor(private readonly home: string) {}

  // Root-agent abort, shutdown and usage records appended since the last read, as spool records named by their type;
  // a usage record keeps its `data.usage` as `usage`.
  read(id: string): SpoolRecord[] {
    let buf: Buffer
    let offset = this.offsets.get(id)
    try {
      const fd = fs.openSync(path.join(this.home, 'session-state', id, 'events.jsonl'), 'r')
      try {
        const size = fs.fstatSync(fd).size
        if (offset === undefined || size < offset) offset = Math.max(0, size - FIRST_READ_MAX)
        if (size <= offset) return []
        buf = Buffer.alloc(size - offset)
        fs.readSync(fd, buf, 0, buf.length, offset)
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      return [] // not there yet, or unreadable; retried by the next poll
    }
    const end = buf.lastIndexOf(0x0a)
    if (end === -1) return [] // no complete line yet
    this.offsets.set(id, offset + end + 1)
    const out: SpoolRecord[] = []
    for (const line of buf.toString('utf8', 0, end).split('\n')) {
      if (!line.includes('"abort"') && !line.includes('"session.shutdown"') && !line.includes('"session.usage_record"')) continue
      try {
        const j = JSON.parse(line) as { type?: unknown; timestamp?: unknown; agentId?: unknown; data?: { usage?: unknown } }
        if (typeof j.type !== 'string' || !TYPES.has(j.type) || typeof j.timestamp !== 'string' || j.agentId != null) continue
        out.push({ t: j.timestamp, e: { hook_event_name: j.type, ...(j.type === 'session.usage_record' && { usage: j.data?.usage }) } })
      } catch {
        // a first read can start mid-line
      }
    }
    return out
  }

  forget(id: string): void {
    this.offsets.delete(id)
  }
}
