import type { StatusEvent } from './contract.ts'

// The agents Grove can run. Each one has an adapter in agents/registry.ts.
export type AgentKind = 'claude' | 'opencode' | 'copilot'

export interface AgentLaunch {
  command: string
  args: string[]
  env: Record<string, string>
  sessionId: string
}

export interface AdapterLaunchInput {
  tabId: string
  cwd: string
  home: string
  resumeId?: string
}

export interface AdapterWatchInput {
  tabId: string
  sessionId: string
  home: string
  clock: () => number
  // `at` is the time the event happened; a source that cannot tell passes the clock.
  onEvent: (event: StatusEvent, at: number) => void
}

export interface AgentWatch {
  close: () => void
}

export interface AgentAdapter {
  kind: AgentKind
  // Throws an Error with a message when a resume id is not valid for this agent.
  launch(input: AdapterLaunchInput): AgentLaunch
  // Starts reporting for one tab. Delivers StatusEvents; the service folds them and owns the sidecar and the cross-check.
  watch(input: AdapterWatchInput): AgentWatch
  // Optional: resolves false when the command is not on the login shell's PATH (the create is refused with agentMissing).
  available?: () => Promise<boolean>
}
