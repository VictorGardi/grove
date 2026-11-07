import path from 'node:path'
import type { AgentAdapter } from '../../status/adapter.ts'
import { hasClaudeHooks, claudeSettingsFile, readSettings } from '../../integrations/install.ts'
import { claudeLaunch, claudeSpoolFile, claudeUsageFile, SESSION_ID } from './launch.ts'
import { createClaudeSource } from './source.ts'
import { createClaudeUsageSource } from './usage.ts'

export interface ClaudeAdapterOptions {
  // Whether the user's Claude settings already carry Grove's hooks. Default: read the settings file on each launch.
  userHooksInstalled?: () => boolean
}

// Whether the user's own Claude settings carry Grove's hooks. An unreadable file counts as not installed.
export function claudeUserHooksInstalled(): boolean {
  try {
    return hasClaudeHooks(readSettings(claudeSettingsFile()))
  } catch {
    return false
  }
}

export function createClaudeAdapter(options: ClaudeAdapterOptions = {}): AgentAdapter {
  const userHooksInstalled = options.userHooksInstalled ?? claudeUserHooksInstalled
  return {
    kind: 'claude',
    launch: (input) => {
      if (input.resumeId !== undefined && !SESSION_ID.test(input.resumeId)) {
        throw new Error('resume id is not a session id')
      }
      const launch = claudeLaunch({ ...input, perLaunchHooks: !userHooksInstalled() })
      return { command: launch.command, args: launch.args, env: launch.env, sessionId: launch.sessionId }
    },
    watch: (input) => {
      const source = createClaudeSource({
        spoolFile: claudeSpoolFile(input.home, input.tabId),
        offsetFile: path.join(input.home, 'agents', 'claude', `${input.tabId}.offset`),
        clock: input.clock,
        onEvent: input.onEvent,
      })
      const onContext = input.onContext
      const usage = onContext && createClaudeUsageSource({ usageFile: claudeUsageFile(input.home, input.tabId), onContext })
      return {
        ...source,
        close: () => {
          usage?.close()
          source.close()
        },
      }
    },
  }
}
