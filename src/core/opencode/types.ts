// Agent-neutral events and the adapter seam (design D2). OpenCode shapes stay in normalise.ts.
export type OcEvent =
  | { type: 'connected'; version: string }
  | { type: 'disconnected' }
  | { type: 'exec-started'; sessionId: string }
  | { type: 'exec-ended'; sessionId: string; at: string } // succeeded | failed | interrupted
  | { type: 'pending'; sessionId: string; id: string; kind: 'permission' | 'question'; open: boolean }
  | { type: 'child'; sessionId: string; parentId: string } // a subagent session and its parent

export interface OpenCodeSource {
  start(onEvent: (e: OcEvent) => void): void // connects and reconnects until stop()
  stop(): void
}
