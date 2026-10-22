import path from 'node:path'
import type { AgentEvent } from '../agents/types'
import type { SpoolRecord } from '../claude/spool'

// One Copilot spool's live state; also its snapshot. `id` is the spool's file id, every event's sessionId.
export interface CopilotFold {
  id: string
  running: boolean
  idleAt: string | null
  pending: Map<string, 'permission' | 'question'> // only perm:main (no question or subagent signal is verified)
  lastWrite: string[] // paths of the latest successful write; [] if none
}

export const emptyFold = (id: string): CopilotFold => ({ id, running: false, idleAt: null, pending: new Map(), lastWrite: [] })

interface Hook {
  hook_event_name?: unknown
  cwd?: unknown
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

// `t` is UTC to the second; seen marks carry milliseconds, and they compare as strings.
const iso = (t: string) => (/\.\d{3}Z$/.test(t) ? t : t.replace(/Z$/, '.000Z'))

// The hook → event mapping. A permissionRequest opens attention; it closes on a tool result, the end of the turn or a new
// prompt (a denied request fires no postToolUse). Known limit: Copilot fires it for auto-approved calls too, so under
// --allow-all-tools a long tool call shows attention for its duration. Never mutates `f`.
export function step(f: CopilotFold, r: SpoolRecord): { fold: CopilotFold; events: AgentEvent[] } {
  if (typeof r.e !== 'object' || r.e === null) return { fold: f, events: [] }
  const e = r.e as Hook
  const sessionId = f.id
  const events: AgentEvent[] = []
  let fold = f

  const closeAll = () => {
    if (!fold.pending.size) return
    for (const [id, kind] of fold.pending) events.push({ type: 'pending', sessionId, id, kind, open: false })
    fold = { ...fold, pending: new Map() }
  }
  const end = () => {
    fold = { ...fold, running: false, idleAt: iso(r.t) }
    events.push({ type: 'exec-ended', sessionId, at: iso(r.t) })
  }

  switch (e.hook_event_name) {
    case 'userPromptSubmitted':
      closeAll()
      fold = { ...fold, running: true }
      events.push({ type: 'exec-started', sessionId })
      break
    case 'permissionRequest':
      if (!fold.pending.has('perm:main')) {
        fold = { ...fold, pending: new Map(fold.pending).set('perm:main', 'permission') }
        events.push({ type: 'pending', sessionId, id: 'perm:main', kind: 'permission', open: true })
      }
      break
    case 'preToolUse': // a turn whose prompt hook was missed still shows working; parallel calls keep each other's attention open
      if (!fold.running) {
        fold = { ...fold, running: true }
        events.push({ type: 'exec-started', sessionId })
      }
      break
    case 'sessionStart': // also fires on a resume: nothing survives an unclean end of the earlier run
      closeAll()
      if (fold.running) end()
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
      closeAll()
      end()
      break
    case 'sessionEnd':
      closeAll()
      if (fold.running) end()
      break
  }
  return fold === f ? { fold: f, events } : { fold, events }
}
