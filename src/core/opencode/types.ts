// Agent-neutral events and the adapter seam (design D2). OpenCode shapes stay in normalise.ts.
export type OcEvent =
  | { type: 'connected'; version: string }
  | { type: 'disconnected' }
  | { type: 'exec-started'; sessionId: string }
  | { type: 'exec-ended'; sessionId: string; at: string } // succeeded | failed | interrupted
  | { type: 'pending'; sessionId: string; id: string; kind: 'permission' | 'question'; open: boolean }
  | { type: 'child'; sessionId: string; parentId: string } // a subagent session and its parent
  | { type: 'wrote'; sessionId: string; paths: string[] } // a write/edit/patch succeeded; raw paths

// A session's state as read on (re)connect; pending items are its own, children listed separately.
export interface SessionSnapshot {
  running: boolean
  idleAt: string | null
  pending: { id: string; kind: 'permission' | 'question' }[]
  children: string[]
}

export interface OpenCodeSource {
  start(onEvent: (e: OcEvent) => void): void // connects and reconnects until stop()
  snapshot(ids: string[]): Promise<Map<string, SessionSnapshot>> // ids and their children; a session OpenCode doesn't know yet is blank
  lastWrites(id: string): Promise<string[]> // paths of the session's latest successful write/edit/patch; [] if none
  stop(): void
}
