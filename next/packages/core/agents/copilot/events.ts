import fs from 'node:fs'
import path from 'node:path'
import type { SpoolRecord } from '../../status/spool.ts'

const TYPES = new Set(['abort', 'assistant.turn_start', 'assistant.turn_end', 'session.shutdown'])
// A first read starts this far before the end: the log also carries whole model snapshots, which are large.
const FIRST_READ_MAX = 1 << 20

// Copilot's own session log <home>/session-state/<id>/events.jsonl (one JSON object per line) supplies root turn
// boundaries when hooks are unavailable, and the abort and shutdown that no hook reports. Tailed by byte offset.
// Root turn events have no agentId; subagent events do and are ignored here.
export class CopilotEventLog {
  private offsets = new Map<string, number>()

  constructor(private readonly home: string) {}

  // Root-agent turn, abort and shutdown records appended since the last read, as spool records named by their type.
  // Only complete lines are read; a line still being written waits for its newline.
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
    if (end === -1) return []
    this.offsets.set(id, offset + end + 1)
    const out: SpoolRecord[] = []
    for (const line of buf.toString('utf8', 0, end).split('\n')) {
      if (!line.includes('"abort"') && !line.includes('"assistant.turn_start"') && !line.includes('"assistant.turn_end"') && !line.includes('"session.shutdown"')) continue
      try {
        const j = JSON.parse(line) as { type?: unknown; timestamp?: unknown; agentId?: unknown }
        if (typeof j.type !== 'string' || !TYPES.has(j.type) || typeof j.timestamp !== 'string' || j.agentId != null) continue
        const at = Date.parse(j.timestamp)
        out.push({ event: j.type, at: Number.isFinite(at) ? at : undefined, payload: { hook_event_name: j.type } })
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
