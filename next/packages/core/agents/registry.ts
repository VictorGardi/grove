import type { AgentAdapter, AgentKind } from '../status/adapter.ts'
import { createClaudeAdapter } from './claude/adapter.ts'
import { createCopilotAdapter } from './copilot/adapter.ts'
import { createOpenCodeAdapter } from './opencode/adapter.ts'

// Every agent the core can run. An agent is added here with one import and one entry.
export const adapters: Partial<Record<AgentKind, AgentAdapter>> = {
  claude: createClaudeAdapter(),
  copilot: createCopilotAdapter(),
  opencode: createOpenCodeAdapter(),
}
