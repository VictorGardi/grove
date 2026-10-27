import path from 'node:path'
import type { AgentEvent } from '../agents/types'
import type { SpoolRecord } from '../claude/spool'

// One Copilot spool's live state; also its snapshot. `id` is the spool's file id, every event's sessionId.
export interface CopilotFold {
  id: string
  running: boolean
  idleAt: string | null
  startedAt: string | null // when the current turn started: an abort or shutdown read from before it is stale
  pending: Map<string, 'permission' | 'question'> // perm:main and q:main, from shown prompts only
  lastWrite: string[] // paths of the latest successful write; [] if none
}

export const emptyFold = (id: string): CopilotFold => ({ id, running: false, idleAt: null, startedAt: null, pending: new Map(), lastWrite: [] })

interface Hook {
  hook_event_name?: unknown
  cwd?: unknown
  timestamp?: unknown
  agentId?: unknown
  notification_type?: unknown
  toolName?: unknown
  toolArgs?: unknown
  toolResult?: unknown
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

// Paths a successful write names. `apply_patch` (verified) carries the patch text as toolArgs; its
// `*** Add File:` / `Update File:` / `Move to:` lines are relative to the hook's cwd. `edit` and `create` with an
// object toolArgs carrying `path` or `file_path` are NOT verified against a real run (the model used here only
// called apply_patch); a shape that does not match yields no path, never a wrong one.
function writePaths(e: Hook): string[] {
  const cwd = str(e.cwd) ?? ''
  const abs = (p: string) => (path.isAbsolute(p) ? p : cwd ? path.join(cwd, p) : '')
  if (e.toolName === 'apply_patch') {
    const patch = str(e.toolArgs)
    if (patch === null) return []
    const out: string[] = []
    for (const m of patch.matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+)$/gm)) out.push(abs(m[1].trim()))
    return out.filter(Boolean)
  }
  if (e.toolName === 'edit' || e.toolName === 'create') {
    let args = e.toolArgs
    if (typeof args === 'string' && args.trimStart().startsWith('{')) {
      try { args = JSON.parse(args) } catch { return [] }
    }
    if (typeof args !== 'object' || args === null) return []
    const a = args as { path?: unknown; file_path?: unknown }
    const p = str(a.path) ?? str(a.file_path)
    return p ? [abs(p)].filter(Boolean) : []
  }
  return []
}

const succeeded = (r: unknown) => typeof r === 'object' && r !== null && (r as { resultType?: unknown }).resultType === 'success'

// `t` is UTC to the second; seen marks carry milliseconds, and they compare as strings. Copilot's own `timestamp`
// (epoch ms, verified on 1.0.103) is preferred when the payload has it.
const iso = (t: string) => (/\.\d{3}Z$/.test(t) ? t : t.replace(/Z$/, '.000Z'))
const at = (r: SpoolRecord, e: Hook) => (typeof e.timestamp === 'number' && Number.isFinite(e.timestamp) ? new Date(e.timestamp).toISOString() : iso(r.t))

// The hook → event mapping. A shown permission prompt or question (`notification`) opens attention; it closes on a tool
// result, the end of the turn or a new prompt (a denied call fires no post hook).
// A subagent's hooks land in the same spool and carry `agentId` (verified on 1.0.103; the root agent's never do),
// including its own userPromptSubmitted and agentStop: they never start or end the turn, so a background subagent
// still working after the turn ends does not flip the card back to working.
// `abort` (Esc) and `session.shutdown` come from Copilot's events.jsonl (events.ts), as no hook fires for an
// interrupted turn; one from before the current turn started is stale. Never mutates `f`.
export function step(f: CopilotFold, r: SpoolRecord): { fold: CopilotFold; events: AgentEvent[] } {
  if (typeof r.e !== 'object' || r.e === null) return { fold: f, events: [] }
  const e = r.e as Hook
  const sessionId = f.id
  const events: AgentEvent[] = []
  let fold = f
  const sub = typeof e.agentId === 'string'

  const closeAll = () => {
    if (!fold.pending.size) return
    for (const [id, kind] of fold.pending) events.push({ type: 'pending', sessionId, id, kind, open: false })
    fold = { ...fold, pending: new Map() }
  }
  const begin = () => {
    fold = { ...fold, running: true, startedAt: at(r, e) }
    events.push({ type: 'exec-started', sessionId })
  }
  const end = () => {
    fold = { ...fold, running: false, idleAt: at(r, e) }
    events.push({ type: 'exec-ended', sessionId, at: at(r, e) })
  }
  const open = (id: string, kind: 'permission' | 'question') => {
    if (fold.pending.has(id)) return
    fold = { ...fold, pending: new Map(fold.pending).set(id, kind) }
    events.push({ type: 'pending', sessionId, id, kind, open: true })
  }

  switch (e.hook_event_name) {
    case 'userPromptSubmitted':
      if (sub) break
      closeAll()
      begin()
      break
    case 'notification':
    case 'Notification': // the payload carries its own hook_event_name, which overrides the stamped one (verified)
      if (e.notification_type === 'permission_prompt') open('perm:main', 'permission')
      else if (e.notification_type === 'elicitation_dialog') open('q:main', 'question')
      break
    case 'preToolUse': // a turn whose prompt hook was missed still shows working; parallel calls keep each other's attention open
      if (!sub && !fold.running) begin()
      break
    case 'sessionStart': // also fires on a resume: nothing survives an unclean end of the earlier run
      if (sub) break
      closeAll()
      if (fold.running) end()
      break
    case 'postToolUseFailure':
      closeAll()
      break
    case 'postToolUse': {
      closeAll()
      if (succeeded(e.toolResult)) {
        const paths = writePaths(e)
        if (paths.length) {
          fold = { ...fold, lastWrite: paths }
          events.push({ type: 'wrote', sessionId, paths })
        }
      }
      break
    }
    case 'agentStop':
      if (sub) break
      closeAll()
      end()
      break
    case 'sessionEnd':
      if (sub) break
      closeAll()
      if (fold.running) end()
      break
    case 'abort':
    case 'session.shutdown':
      if (sub || !fold.running || (fold.startedAt !== null && at(r, e) < fold.startedAt)) break
      closeAll()
      end()
      break
  }
  return fold === f ? { fold: f, events } : { fold, events }
}
