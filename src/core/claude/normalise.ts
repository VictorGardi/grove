import type { AgentEvent } from '../agents/types'
import type { SpoolRecord } from './spool'

// One spool's live state; also its snapshot. `id` is the spool's file id, every event's sessionId.
export interface ClaudeFold {
  id: string
  running: boolean
  idleAt: string | null
  pending: Map<string, 'permission' | 'question'> // perm:<scope> | q:<tool_use_id>
}

export const emptyFold = (id: string): ClaudeFold => ({ id, running: false, idleAt: null, pending: new Map() })

interface Hook {
  hook_event_name?: unknown
  tool_name?: unknown
  tool_use_id?: unknown
  agent_id?: unknown
}

// `t` is UTC to the second; seen marks carry milliseconds, and they compare as strings.
const iso = (t: string) => (/\.\d{3}Z$/.test(t) ? t : t.replace(/Z$/, '.000Z'))

// The hook → event mapping (design table; checked against both captures). Never mutates `f`.
export function step(f: ClaudeFold, r: SpoolRecord): { fold: ClaudeFold; events: AgentEvent[] } {
  if (typeof r.e !== 'object' || r.e === null) return { fold: f, events: [] }
  const e = r.e as Hook
  const scope = typeof e.agent_id === 'string' ? e.agent_id : 'main'
  const sessionId = f.id
  const events: AgentEvent[] = []
  let pending = f.pending
  let fold = f

  const close = (keep: (id: string) => boolean) => {
    for (const [id, kind] of pending) {
      if (keep(id)) continue
      if (pending === f.pending) pending = new Map(f.pending)
      pending.delete(id)
      events.push({ type: 'pending', sessionId, id, kind, open: false })
    }
  }
  const open = (id: string, kind: 'permission' | 'question') => {
    pending = new Map(pending).set(id, kind)
    events.push({ type: 'pending', sessionId, id, kind, open: true })
  }
  const end = () => {
    fold = { ...fold, running: false, idleAt: iso(r.t) }
    events.push({ type: 'exec-ended', sessionId, at: iso(r.t) })
  }

  switch (e.hook_event_name) {
    case 'UserPromptSubmit':
      close(() => false)
      fold = { ...fold, running: true }
      events.push({ type: 'exec-started', sessionId })
      break
    case 'PermissionRequest':
      if (e.tool_name !== 'AskUserQuestion') open(`perm:${scope}`, 'permission') // it fires for questions too
      break
    case 'PreToolUse':
      if (e.tool_name === 'AskUserQuestion' && typeof e.tool_use_id === 'string') open(`q:${e.tool_use_id}`, 'question')
      break
    case 'PostToolUse':
    case 'PostToolUseFailure':
      close((id) => id !== `perm:${scope}` && id !== `q:${String(e.tool_use_id)}`)
      break
    case 'PostToolBatch': // a marker without scope
      close((id) => !id.startsWith('perm:'))
      break
    case 'Stop':
    case 'StopFailure':
      if (scope !== 'main') break
      close(() => false)
      end()
      break
    case 'Notification': // idle_prompt: an interrupt or an Esc-rejected question fires no other hook
      close(() => false)
      if (fold.running) end()
      break
  }
  if (events.length === 0) return { fold: f, events }
  return { fold: { ...fold, pending }, events }
}
