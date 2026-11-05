import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AdapterLaunchInput, AdapterWatchInput, AgentAdapter, AgentLaunch, AgentWatch } from '../../status/adapter.ts'
import type { StatusEvent } from '../../status/contract.ts'
import { createSpoolSource, type SpoolRecord } from '../../status/spool.ts'
import { copilotSettingsFile, hasCopilotHooks, readSettings } from '../../integrations/install.ts'
import { commandOnPath } from '../commandOnPath.ts'
import { findCopilotSession } from './discover.ts'
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
  // Whether the user's Copilot settings already carry Grove's hooks. Default: read the settings file on each launch.
  userHooksInstalled?: () => boolean
}

// Copilot's own dir: the option, else $COPILOT_HOME, else ~/.copilot.
function copilotHomeOf(options: CopilotAdapterOptions): string {
  return options.copilotHome ?? process.env.COPILOT_HOME ?? path.join(os.homedir(), '.copilot')
}

// Whether the user's own Copilot settings carry Grove's hooks. An unreadable file counts as not installed.
function userHooksInstalledIn(copilotHome: string): boolean {
  try {
    return hasCopilotHooks(readSettings(copilotSettingsFile({ COPILOT_HOME: copilotHome })))
  } catch {
    return false
  }
}

export function createCopilotAdapter(options: CopilotAdapterOptions = {}): AgentAdapter {
  const copilotHome = () => copilotHomeOf(options)
  const userHooksInstalled = options.userHooksInstalled ?? (() => userHooksInstalledIn(copilotHome()))
  return {
    kind: 'copilot',
    launch: (input) => launch(input, userHooksInstalled()),
    watch: (input) => watch(input, { ...options, copilotHome: copilotHome() }),
    // A hand-started session is found from its folder and start time, before its first hook.
    discover: async ({ cwd, since }) => findCopilotSession({ copilotHome: copilotHome(), cwd, since }),
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

// A fresh launch names its session; a resume reuses the id Copilot reported. The per-launch plugin is left out when the
// user's settings carry Grove's hooks: both would append every event to the same spool, and each would be read twice.
function launch(input: AdapterLaunchInput, userHooksInstalled: boolean): AgentLaunch {
  if (input.resumeId !== undefined && !UUID.test(input.resumeId)) throw new Error('resume id is not a session id')
  const sessionId = input.resumeId ?? randomUUID()
  const identity = input.resumeId !== undefined ? [`--resume=${sessionId}`] : ['--session-id', sessionId]
  if (userHooksInstalled) return { command: 'copilot', args: identity, env: {}, sessionId }
  const plugin = writePlugin(input.home, input.tabId)
  return { command: 'copilot', args: [...identity, '--plugin-dir', plugin], env: {}, sessionId }
}

// The hook spool and Copilot's log feed one fold, so a turn seen by either is one state. The spool is read by the
// generic source; the log is polled here, its first read folded silently and then reported once as the state it
// leaves (when it had any), so a restored tab shows where it is without replaying an old end.
function watch(input: AdapterWatchInput, options: CopilotAdapterOptions): AgentWatch {
  const { home, tabId, clock, onEvent } = input
  const log = new CopilotEventLog(options.copilotHome ?? process.env.COPILOT_HOME ?? path.join(os.homedir(), '.copilot'))
  let fold: CopilotFold = emptyFold()
  // An agent found by hand starts with no session id: discovery or its first hook says which session it is, and the log is read from then.
  let logSession = input.sessionId

  // Defined before the spool source below: its first drain runs as the source is created, and a hand-started agent's
  // first record reads the log through here.
  const fromLog = (records: SpoolRecord[], initial: boolean) => {
    for (const record of records) {
      const out = step(fold, record, clock())
      fold = out.fold
      if (!initial) for (const event of out.events) onEvent(event, record.at ?? clock())
    }
  }
  // The log of a session found by its first hook, folded silently: the hook records already said where it is.
  const replayLog = (id: string): StatusEvent[] => {
    const records = log.read(id)
    const wasRunningNow = fold.running
    fromLog(records, true)
    return wasRunningNow && !fold.running ? [{ kind: 'idle-prompt' }] : stateEvents(fold)
  }

  const fromSpool = (record: SpoolRecord): StatusEvent[] => {
    if (logSession === '') {
      const found = sessionOf(record.payload)
      if (found !== undefined) {
        logSession = found
        onEvent({ kind: 'session', resumeId: found }, clock())
        for (const event of replayLog(found)) onEvent(event, clock())
      }
    }
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

  // Only when the log had records: a state the spool already delivered is not said twice. A turn the spool left
  // running that the log's abort or end closed is said once as finished, so it does not stay working.
  const initial = logSession === '' ? [] : log.read(logSession)
  const wasRunning = fold.running
  fromLog(initial, true)
  if (wasRunning && !fold.running) onEvent({ kind: 'idle-prompt' }, clock())
  else if (initial.length > 0) for (const event of stateEvents(fold)) onEvent(event, clock())
  const timer = setInterval(() => {
    if (logSession !== '') fromLog(log.read(logSession), false)
  }, LOG_POLL_MS)

  return {
    close: () => {
      clearInterval(timer)
      source.close()
      if (logSession !== '') log.forget(logSession)
    },
  }
}

// The session a Copilot hook names. Every hook's stdin carries its sessionId (verified on Copilot 1.0.105).
function sessionOf(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const id = (payload as { sessionId?: unknown }).sessionId
  return typeof id === 'string' && id !== '' ? id : undefined
}
