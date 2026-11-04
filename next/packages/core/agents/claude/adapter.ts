import path from 'node:path'
import type { AgentAdapter } from '../../status/adapter.ts'
import { claudeLaunch, claudeSpoolFile, SESSION_ID } from './launch.ts'
import { createClaudeSource } from './source.ts'

export function createClaudeAdapter(): AgentAdapter {
  return {
    kind: 'claude',
    launch: (input) => {
      if (input.resumeId !== undefined && !SESSION_ID.test(input.resumeId)) {
        throw new Error('resume id is not a session id')
      }
      const launch = claudeLaunch(input)
      return { command: launch.command, args: launch.args, env: launch.env, sessionId: launch.sessionId }
    },
    watch: (input) =>
      createClaudeSource({
        spoolFile: claudeSpoolFile(input.home, input.tabId),
        offsetFile: path.join(input.home, 'agents', 'claude', `${input.tabId}.offset`),
        clock: input.clock,
        onEvent: input.onEvent,
      }),
  }
}
