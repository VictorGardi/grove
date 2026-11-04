import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AdapterLaunchInput, AdapterWatchInput, AgentAdapter, AgentLaunch, AgentWatch } from '../../status/adapter.ts'
import type { StatusEvent } from '../../status/contract.ts'
import { createSpoolSource, type SpoolRecord } from '../../status/spool.ts'
import { commandOnPath } from '../commandOnPath.ts'
import { CopilotEventLog } from './events.ts'
import { hooksJson, parseCopilotLine, pluginJson } from './hooks.ts'
import { emptyFold, stateEvents, step, type CopilotFold } from './normalise.ts'

// Copilot's session ids are UUIDs. Anything else must never reach the command line as a flag.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Copilot's log has no hook, so it is polled at the spool's pace.
const LOG_POLL_MS = 1000

export interface CopilotAdapterOptions {
  // Copilot's own dir, which holds session-state/<id>/events.jsonl. Default $COPILOT_HOME or ~/.copilot.
  copilotHome?: string
  // The login shell the command probe runs in. Default $SHELL or /bin/zsh.
  shell?: string
}

export function createCopilotAdapter(options: CopilotAdapterOptions = {}): AgentAdapter {
  return {
    kind: 'copilot',
    launch: (input) => launch(input),
    watch: (input) => watch(input, options),
    available: () => commandOnPath('copilot', options.shell ?? process.env.SHELL ?? '/bin/zsh'),
  }
}

function agentDir(home: string): string {
  return path.join(home, 'agents', 'copilot')
}

function spoolFile(home: string, tabId: string): string {
  return path.join(agentDir(home), `${tabId}.jsonl`)
}

// Rewritten at every launch, so a moved app dir stays right. Holds only this tab's hooks.
function writePlugin(home: string, tabId: string): string {
  const dir = path.join(agentDir(home), `${tabId}.plugin`)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(dir, 'plugin.json'), pluginJson)
  fs.writeFileSync(path.join(dir, 'hooks.json'), hooksJson(spoolFile(home, tabId)))
  return dir
}

// A fresh launch names its session; a resume reuses the id Copilot reported.
function launch(input: AdapterLaunchInput): AgentLaunch {
  if (input.resumeId !== undefined && !UUID.test(input.resumeId)) throw new Error('resume id is not a session id')
  const sessionId = input.resumeId ?? randomUUID()
  const plugin = writePlugin(input.home, input.tabId)
  const identity = input.resumeId !== undefined ? [`--resume=${sessionId}`] : ['--session-id', sessionId]
  return { command: 'copilot', args: [...identity, '--plugin-dir', plugin], env: {}, sessionId }
}

// The hook spool and Copilot's log feed one fold, so a turn seen by either is one state. The spool is read by the
// generic source; the log is polled here, its first read folded silently and then reported once as the state it
// leaves (when it had any), so a restored tab shows where it is without replaying an old end.
function watch(input: AdapterWatchInput, options: CopilotAdapterOptions): AgentWatch {
  const { home, tabId, sessionId, clock, onEvent } = input
  const log = new CopilotEventLog(options.copilotHome ?? process.env.COPILOT_HOME ?? path.join(os.homedir(), '.copilot'))
  let fold: CopilotFold = emptyFold()

  const fromSpool = (record: SpoolRecord): StatusEvent[] => {
    const out = step(fold, record, clock())
    fold = out.fold
    return out.events
  }
  const source = createSpoolSource({
    spoolFile: spoolFile(home, tabId),
    offsetFile: path.join(agentDir(home), `${tabId}.offset`),
    clock,
    onEvent,
    toEvents: fromSpool,
    parse: parseCopilotLine,
  })

  const fromLog = (records: SpoolRecord[], initial: boolean) => {
    for (const record of records) {
      const out = step(fold, record, clock())
      fold = out.fold
      if (!initial) for (const event of out.events) onEvent(event, record.at ?? clock())
    }
  }
  // Only when the log had records: a state the spool already delivered is not said twice. A turn the spool left
  // running that the log's abort or end closed is said once as finished, so it does not stay working.
  const initial = log.read(sessionId)
  const wasRunning = fold.running
  fromLog(initial, true)
  if (wasRunning && !fold.running) onEvent({ kind: 'idle-prompt' }, clock())
  else if (initial.length > 0) for (const event of stateEvents(fold)) onEvent(event, clock())
  const timer = setInterval(() => fromLog(log.read(sessionId), false), LOG_POLL_MS)

  return {
    close: () => {
      clearInterval(timer)
      source.close()
      log.forget(sessionId)
    },
  }
}
