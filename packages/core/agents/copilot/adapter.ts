import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { AdapterLaunchInput, AdapterWatchInput, AgentAdapter, AgentLaunch, AgentWatch } from '../../status/adapter.ts'
import { commandOnPath } from '../commandOnPath.ts'
import { findCopilotSession } from './discover.ts'
import { createCopilotUsageSource } from './usage.ts'

// Copilot's session ids are UUIDs. Anything else must never reach the command line as a flag.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface CopilotAdapterOptions {
  // Copilot's own dir, which holds session-state/<id>/events.jsonl. Default $COPILOT_HOME or ~/.copilot.
  copilotHome?: string
  // The login shell the command probe runs in. Default $SHELL or /bin/zsh.
  shell?: string
}

// Copilot's own dir: the option, else $COPILOT_HOME, else ~/.copilot.
function copilotHomeOf(options: CopilotAdapterOptions): string {
  return options.copilotHome ?? process.env.COPILOT_HOME ?? path.join(os.homedir(), '.copilot')
}

export function createCopilotAdapter(options: CopilotAdapterOptions = {}): AgentAdapter {
  const copilotHome = () => copilotHomeOf(options)
  return {
    kind: 'copilot',
    launch,
    // Status comes from OSC 7501 through the holder; the context reading comes from the session's own usage log.
    watch,
    // A hand-started session is found from its folder and start time.
    discover: async ({ cwd, since, exclude }) => findCopilotSession({ copilotHome: copilotHome(), cwd, since, exclude }),
    available: () => commandOnPath('copilot', options.shell ?? process.env.SHELL ?? '/bin/zsh'),
  }

  // Watches one session's usage log for the tab. Without a session id (a hand-started tab before discovery, or an
  // input without onContext) there is nothing to read yet; the service restarts this watch with the id once it is
  // known, and the log's newest record is replayed at once.
  function watch(input: AdapterWatchInput): AgentWatch {
    const onContext = input.onContext
    if (input.sessionId === '' || onContext === undefined) return { close: () => {} }
    const usage = createCopilotUsageSource({
      file: path.join(copilotHome(), 'session-state', input.sessionId, 'events.jsonl'),
      onContext,
    })
    return { close: () => usage.close() }
  }
}

// A fresh launch names its session; a resume reuses the id Copilot reported.
function launch(input: AdapterLaunchInput): AgentLaunch {
  if (input.resumeId !== undefined && !UUID.test(input.resumeId)) throw new Error('resume id is not a session id')
  const sessionId = input.resumeId ?? randomUUID()
  const identity = input.resumeId !== undefined ? [`--resume=${sessionId}`] : ['--session-id', sessionId]
  return { command: 'copilot', args: identity, env: {}, sessionId }
}
