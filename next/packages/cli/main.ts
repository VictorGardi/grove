import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureHolder } from '../core/holder-client.ts'
import { connectWhenReady, type RpcClient } from '../protocol/client.ts'
import { METHODS, type AgentInfo, type SpaceTabInfo } from '../protocol/messages.ts'
import { coreSocketPath } from '../protocol/paths.ts'
import { parseCommand, UsageError, type Command } from './args.ts'
import { formatError, formatLsJson, formatNew, formatRead, formatTree, spaceHeadings, turnExit, type LsTab, type TurnOutcome } from './output.ts'
import { pasteText, waitStable } from './paste.ts'
import { resolveTabRef } from './ref.ts'
import { agentSkillsDirs, installSkill } from './skill.ts'
import { buildId } from '../core/build.ts'
import { claudeSettingsFile, copilotSettingsFile, installClaude, installCopilot, uninstallClaude, uninstallCopilot } from '../core/integrations/install.ts'
import { waitForWorking, waitTurn, type WaitDeps, type WaitTab } from './wait.ts'

const CORE_UNREACHABLE = 3
const COLS = 120
const ROWS = 40
const DEFAULT_TIMEOUT_S = 600

// The holder or the core could not be reached: exit 3, not a generic error.
class CoreUnreachable extends Error {}

// Runs one CLI command and returns its exit code: 0 ok, 1 error (one line on stderr), 2 usage, 3 core unreachable,
// 5 gone, 124 timeout.
export async function main(argv: string[]): Promise<number> {
  const command = parseCommand(argv)
  if (command instanceof UsageError) {
    console.error(command.message)
    return 2
  }
  try {
    return await run(command)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(formatError(message))
    return error instanceof CoreUnreachable ? CORE_UNREACHABLE : 1
  }
}

async function run(command: Command): Promise<number> {
  switch (command.cmd) {
    case 'ls':
      return listTabs(command.json)
    case 'space-ls':
      return listTabs(false)
    case 'space-add':
      return addSpace(command.path)
    case 'new':
      return newTab(command)
    case 'send':
      return send(command)
    case 'wait':
      return waitCommand(command)
    case 'focus':
      return withCore(async (core) => {
        await core.request(METHODS.tabsFocus, { id: (await resolveRef(core, command.ref)).id })
        return 0
      })
    case 'kill':
      return withCore(async (core) => {
        await core.request(METHODS.tabsClose, { id: (await resolveRef(core, command.ref)).id })
        return 0
      })
    case 'read':
      return withCore(async (core) => {
        const { text } = await core.request(METHODS.tabsScreen, { id: (await resolveRef(core, command.ref)).id })
        console.log(formatRead(text, command.lines))
        return 0
      })
    case 'config-path':
      return withCore(async (core) => {
        const { path: folder } = await core.request(METHODS.configGet, {})
        console.log(folder)
        return 0
      })
    case 'skill':
      return installSkills()
    case 'integration':
      return integration(command.action, command.agent)
  }
}

// One line per folder: written, or why not. Exit 1 if any folder failed.
function installSkills(): number {
  const results = installSkill({ dirs: agentSkillsDirs(os.homedir(), process.env) })
  for (const result of results) console.log(result.ok ? `✓ ${result.target}` : `✗ ${result.target}: ${result.error}`)
  return results.every((result) => result.ok) ? 0 : 1
}

// Starts the holder (and through it the core) when needed, then runs one call against the core.
async function withCore<T>(call: (core: RpcClient) => Promise<T>): Promise<T> {
  try {
    await ensureHolder()
  } catch (error) {
    throw new CoreUnreachable(error instanceof Error ? error.message : String(error))
  }
  let core: RpcClient
  try {
    core = await connectWhenReady(coreSocketPath())
  } catch (error) {
    throw new CoreUnreachable(error instanceof Error ? error.message : String(error))
  }
  try {
    // A core that started before this build keeps its old code: it cannot see agents typed by hand, so say so.
    const { build } = await core.request(METHODS.corePing, {})
    if (build !== buildId()) {
      throw new Error('the running core is from an older build; stop it (quit Grove, or end the grove-next core process) and run again')
    }
    return await call(core)
  } finally {
    core.close()
  }
}

async function addSpace(arg: string | undefined): Promise<number> {
  const base = process.env.GROVE_NEXT_CALLER_CWD || process.cwd()
  const target = path.resolve(base, arg ?? '')
  return withCore(async (core) => {
    // Always a new space, even when the folder is one already; it prints the new space's heading.
    const space = await core.request(METHODS.spacesAdd, { path: target })
    const { spaces } = await core.request(METHODS.spacesList, {})
    console.log(`added ${spaceHeadings(spaces).get(space.id) ?? space.path}`)
    return 0
  })
}

async function listTabs(json: boolean): Promise<number> {
  return withCore(async (core) => {
    const [result, agents] = await Promise.all([core.request(METHODS.spacesList, {}), core.request(METHODS.agentsList, {})])
    if (result.refused !== null) {
      console.error(formatError(result.refused))
      return 1
    }
    const tabs = lsTabs(result.tabs, agents)
    if (json) {
      console.log(formatLsJson(tabs))
      return 0
    }
    if (result.spaces.length === 0) console.log('no spaces')
    for (const line of formatTree(result.spaces, tabs)) console.log(line)
    return 0
  })
}

function lsTabs(tabs: SpaceTabInfo[], agents: AgentInfo[]): LsTab[] {
  return tabs.map((tab) => ({
    id: tab.id,
    spaceId: tab.spaceId,
    spacePath: tab.spacePath,
    kind: tab.kind,
    state: tab.kind === 'terminal' ? null : (agents.find((agent) => agent.tabId === tab.id)?.state ?? null),
    label: tab.label,
    alive: tab.alive,
  }))
}

async function newTab(cmd: Extract<Command, { cmd: 'new' }>): Promise<number> {
  const base = process.env.GROVE_NEXT_CALLER_CWD || process.cwd()
  const dir = realpathOrSelf(path.resolve(base, cmd.cwd ?? ''))
  return withCore(async (core) => {
    // A folder means its first space.
    const { spaces } = await core.request(METHODS.spacesList, {})
    const space = spaces.find((candidate) => candidate.path === dir)
    if (space === undefined) {
      throw new Error(`not a space: ${dir}, add it with grove-next space add`)
    }
    const prompt = cmd.prompt === undefined ? undefined : readText(cmd.prompt)
    const id =
      cmd.kind === 'terminal'
        ? (await core.request(METHODS.tabsOpen, { spaceId: space.id, cols: COLS, rows: ROWS, label: cmd.label })).id
        : (await core.request(METHODS.tabsCreate, { command: cmd.kind, cwd: dir, cols: COLS, rows: ROWS, label: cmd.label, agent: { kind: cmd.kind } })).id
    console.log(formatNew({ id, kind: cmd.kind, spaceId: space.id, spacePath: dir, label: cmd.label ?? null }, cmd.json))
    if (prompt !== undefined) {
      await settleAndPaste(core, id, prompt, true)
      await afterPaste(core, { id, kind: cmd.kind }, true)
    }
    return cmd.wait ? reportTurn(id, await waitTurn(waitDeps(core), id, { expectStart: true, timeoutMs: timeoutMs(cmd.timeoutS) })) : 0
  })
}

async function send(cmd: Extract<Command, { cmd: 'send' }>): Promise<number> {
  return withCore(async (core) => {
    const tab = await resolveRef(core, cmd.ref)
    if (!tab.alive) {
      if (tab.kind === 'terminal') throw new Error(`tab ${tab.id} is gone`)
      await core.request(METHODS.tabsCreate, { id: tab.id, command: tab.kind, cwd: tab.spacePath, cols: COLS, rows: ROWS, agent: { kind: tab.kind } })
      await settleAndPaste(core, tab.id, readText(cmd.text), cmd.submit)
    } else {
      await pasteText(writer(core, tab.id), readText(cmd.text), cmd.submit)
    }
    await afterPaste(core, tab, cmd.submit)
    return cmd.wait ? reportTurn(tab.id, await waitTurn(waitDeps(core), tab.id, { expectStart: true, timeoutMs: timeoutMs(cmd.timeoutS) })) : 0
  })
}

async function waitCommand(cmd: Extract<Command, { cmd: 'wait' }>): Promise<number> {
  return withCore(async (core) => {
    const tab = await resolveRef(core, cmd.ref)
    return reportTurn(tab.id, await waitTurn(waitDeps(core), tab.id, { expectStart: false, timeoutMs: timeoutMs(cmd.timeoutS) }))
  })
}

// A fresh or resumed agent draws its prompt first; its input is taken once the screen has settled.
async function settleAndPaste(core: RpcClient, id: string, text: string, submit: boolean): Promise<void> {
  const settled = await waitStable(async () => (await core.request(METHODS.tabsScreen, { id })).text)
  if (!settled) throw new Error(`tab ${id} did not settle within 20 s`)
  await pasteText(writer(core, id), text, submit)
}

// After a submitted paste, an agent is given time to start its turn; a timeout here is not an error.
async function afterPaste(core: RpcClient, tab: { id: string; kind: string }, submit: boolean): Promise<void> {
  if (submit && tab.kind !== 'terminal') await waitForWorking(tabFinder(core), tab.id)
}

function writer(core: RpcClient, id: string): (data: string) => Promise<void> {
  return async (data) => {
    await core.request(METHODS.tabsWrite, { id, dataB64: Buffer.from(data).toString('base64') })
  }
}

// Prints why a wait ended without a turn, and returns its exit code.
function reportTurn(id: string, outcome: TurnOutcome): number {
  if (outcome.ok && outcome.data.status === 'idle') return 0
  if (outcome.ok) console.error(formatError(`tab ${id} is gone`))
  else if (outcome.error === 'timeout') console.error(formatError(`timed out waiting for tab ${id}`))
  else if (outcome.error === 'no-status') console.error(formatError(`tab ${id} is a shell, it has no agent state to wait on`))
  else console.error(formatError(`no such tab: ${id}`))
  return turnExit(outcome)
}

function tabFinder(core: RpcClient): (id: string) => Promise<WaitTab | undefined> {
  return async (id) => {
    const [result, agents] = await Promise.all([core.request(METHODS.spacesList, {}), core.request(METHODS.agentsList, {})])
    const tab = result.tabs.find((candidate) => candidate.id === id)
    if (!tab) return undefined
    const agent = agents.find((candidate) => candidate.tabId === id)
    return { kind: tab.kind, alive: tab.alive, state: agent?.state ?? null, reason: agent?.reason }
  }
}

function waitDeps(core: RpcClient): WaitDeps {
  return { find: tabFinder(core), onChange: (cb) => core.onNotification('status.changed', () => cb()) }
}

async function resolveRef(core: RpcClient, ref: string): Promise<SpaceTabInfo> {
  const { tabs } = await core.request(METHODS.spacesList, {})
  const found = resolveTabRef(tabs, ref)
  if (!found.ok) {
    throw new Error(found.error === 'ambiguous' ? `${ref} matches more than one tab` : `no tab matches ${ref}`)
  }
  return tabs.find((tab) => tab.id === found.id) as SpaceTabInfo
}

const timeoutMs = (timeoutS: number | undefined): number => (timeoutS ?? DEFAULT_TIMEOUT_S) * 1000

// A text argument, or standard input for `-`.
function readText(arg: string): string {
  return arg === '-' ? fs.readFileSync(0, 'utf8') : arg
}

function realpathOrSelf(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch {
    return target
  }
}

// Run directly (node --import tsx packages/cli/main.ts, or bin/grove-next), not when imported by a test.
function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    },
  )
}

// Adds or removes the hooks that report agents typed by hand. Writes only the agent's own settings file, after a backup.
// Running agents pick the change up at their next start. OpenCode is read through its shared service, so it needs none.
function integration(action: 'install' | 'uninstall', agent: 'claude' | 'copilot' | 'opencode'): number {
  if (agent === 'opencode') {
    console.log('opencode needs no integration: grove-next reads its shared service.')
    return 0
  }
  const file = agent === 'claude' ? claudeSettingsFile() : copilotSettingsFile()
  const result =
    agent === 'claude'
      ? action === 'install' ? installClaude(file) : uninstallClaude(file)
      : action === 'install' ? installCopilot(file) : uninstallCopilot(file)
  if (!result.changed) console.log(`${file}: no change`)
  else {
    console.log(`${file}: ${action === 'install' ? 'hooks added' : 'hooks removed'}`)
    if (result.backup !== null) console.log(`backup of the file as it was before the first change: ${result.backup}`)
  }
  return 0
}

