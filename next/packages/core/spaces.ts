import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RpcClient } from '../protocol/client.ts'
import { ERROR_CODES, METHODS, type MethodMap, type SpaceInfo, type SpaceTabInfo } from '../protocol/messages.ts'
import { RpcError } from '../protocol/errors.ts'
import { spaceGitInfo } from './git.ts'
import {
  emptyState,
  loadState,
  recordSpaceId,
  saveState,
  tabSpaceId,
  type SpaceRecord,
  type StateV1,
  type TabRecord,
} from './store/state.ts'

type SpacesList = MethodMap['spaces.list']['result']

const SHELL_COLS = 80
const SHELL_ROWS = 24
const TAB_LABEL_MAX = 80

// Owns the saved spaces and tabs. The state file is written only when the core accepts the change;
// a refused file (unknown version) is never written.
export class SpacesService {
  private state: StateV1
  private readonly refused: string | null

  constructor(private readonly file: string) {
    const loaded = loadState(file)
    if (loaded.kind === 'refused') {
      this.state = emptyState()
      this.refused = loaded.reason
    } else {
      this.state = loaded.state
      this.refused = null
    }
  }

  async list(holder: RpcClient): Promise<SpacesList> {
    const spaces = await Promise.all(this.state.spaces.map((space) => this.describe(space, this.state.spaces)))
    const holderTabs = await holder.request(METHODS.tabsList, {})
    const tabs: SpaceTabInfo[] = this.state.tabs.map((tab) => {
      const live = holderTabs.find((candidate) => candidate.id === tab.id)
      return {
        id: tab.id,
        spaceId: tabSpaceId(tab),
        spacePath: tab.spacePath,
        kind: tab.agent ?? 'terminal',
        label: tab.label ?? null,
        alive: live?.alive ?? false,
        exitCode: live?.exitCode ?? null,
      }
    })
    return { spaces, tabs, refused: this.refused }
  }

  async add(spacePath: string): Promise<SpaceInfo> {
    this.assertNotRefused()
    if (!path.isAbsolute(spacePath)) {
      throw new RpcError(ERROR_CODES.invalidParams, `path must be absolute: ${spacePath}`)
    }
    let real: string
    try {
      real = fs.realpathSync(spacePath)
    } catch {
      throw new RpcError(ERROR_CODES.invalidParams, `no such folder: ${spacePath}`)
    }
    if (!fs.statSync(real).isDirectory()) {
      throw new RpcError(ERROR_CODES.invalidParams, `not a folder: ${real}`)
    }
    // Always a new space: two spaces may share a folder, each with its own tabs. The id is opaque and never a path.
    const space: SpaceRecord = { id: this.newSpaceId(), path: real }
    const next: StateV1 = { ...this.state, spaces: [...this.state.spaces, space] }
    saveState(this.file, next)
    this.state = next
    return this.describe(space, next.spaces)
  }

  async openTab(
    spaceId: string,
    cols: number,
    rows: number,
    holder: RpcClient,
    label?: string,
    env: Record<string, string> = {},
  ): Promise<{ id: string }> {
    this.assertNotRefused()
    const space = this.spaceById(spaceId)
    if (space === undefined) {
      throw new RpcError(ERROR_CODES.invalidParams, `no such space: ${spaceId}`)
    }
    const id = crypto.randomUUID().slice(0, 8)
    await holder.request(METHODS.tabsCreate, {
      id,
      command: loginShell(),
      args: ['-l'],
      cwd: space.path,
      env,
      cols,
      rows,
    })
    const base: TabRecord = { id, spaceId, spacePath: space.path }
    const tab: TabRecord = label === undefined ? base : { ...base, label }
    const next: StateV1 = { ...this.state, tabs: [...this.state.tabs, tab] }
    saveState(this.file, next)
    this.state = next
    return { id }
  }

  // Recreates, as fresh login shells, the saved tabs the holder does not know at all.
  // Tabs the holder still has (alive or exited) are left alone. A tab that fails to start is logged
  // and skipped so the others are still restored. Returns the number actually restored.
  async restore(holder: RpcClient, env: Record<string, string> = {}): Promise<number> {
    if (this.refused !== null) return 0
    const known = new Set((await holder.request(METHODS.tabsList, {})).map((tab) => tab.id))
    let restored = 0
    for (const tab of this.state.tabs) {
      // An agent tab is never restarted as a shell; when its holder tab is gone it is resumed on request.
      if (known.has(tab.id) || tab.agent !== undefined) continue
      try {
        await holder.request(METHODS.tabsCreate, {
          id: tab.id,
          command: loginShell(),
          args: ['-l'],
          cwd: rootFor(tab.spacePath),
          env,
          cols: SHELL_COLS,
          rows: SHELL_ROWS,
        })
        restored += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`core: could not restore tab ${tab.id} in ${tab.spacePath}: ${message}`)
      }
    }
    return restored
  }

  isSpace(spaceId: string): boolean {
    return this.spaceById(spaceId) !== undefined
  }

  spaceById(spaceId: string): SpaceRecord | undefined {
    return this.state.spaces.find((space) => space.id === spaceId)
  }

  // The first space of a folder, the one the CLI uses for a folder.
  firstSpaceAt(spacePath: string): SpaceRecord | undefined {
    return this.state.spaces.find((space) => space.path === spacePath)
  }

  tabRecord(id: string): TabRecord | undefined {
    return this.state.tabs.find((tab) => tab.id === id)
  }

  agentTabs(): TabRecord[] {
    return this.state.tabs.filter((tab) => tab.agent !== undefined)
  }

  // Adds an agent tab, or updates the record of a tab with the same id (a resume keeps its place).
  saveAgentTab(tab: TabRecord): void {
    this.assertNotRefused()
    const index = this.state.tabs.findIndex((candidate) => candidate.id === tab.id)
    const tabs = index === -1 ? [...this.state.tabs, tab] : this.state.tabs.map((candidate, i) => (i === index ? tab : candidate))
    const next: StateV1 = { ...this.state, tabs }
    saveState(this.file, next)
    this.state = next
  }

  // Drops a tab's saved record, so a restart does not recreate it. An id with no record is left as it is.
  removeTab(id: string): void {
    this.assertNotRefused()
    if (!this.tabRecord(id)) return
    const next: StateV1 = { ...this.state, tabs: this.state.tabs.filter((tab) => tab.id !== id) }
    saveState(this.file, next)
    this.state = next
  }

  // Sets the label the window shows in place of "Tab N". The label is trimmed; an empty one clears it.
  rename(id: string, label: string): void {
    this.assertNotRefused()
    const record = this.tabRecord(id)
    if (!record) throw new RpcError(ERROR_CODES.invalidParams, `no such tab: ${id}`)
    const trimmed = label.trim()
    if (trimmed.length > TAB_LABEL_MAX) {
      throw new RpcError(ERROR_CODES.invalidParams, `label must be ${TAB_LABEL_MAX} characters or fewer`)
    }
    if (trimmed === '') {
      const { label: _cleared, ...unlabelled } = record
      this.saveAgentTab(unlabelled)
    } else {
      this.saveAgentTab({ ...record, label: trimmed })
    }
  }

  // Keeps the saved session id current; a /clear inside Claude gives a new one. A refused state is never written.
  setAgentSession(id: string, sessionId: string): void {
    const record = this.tabRecord(id)
    if (this.refused !== null || !record || record.agentSessionId === sessionId) return
    this.saveAgentTab({ ...record, agentSessionId: sessionId })
  }

  assertNotRefused(): void {
    if (this.refused !== null) throw new RpcError(ERROR_CODES.stateRefused, this.refused)
  }

  // A random id not used by any space. Ids of spaces saved before ids existed are their paths, and are kept.
  private newSpaceId(): string {
    const ids = new Set(this.state.spaces.map((space) => space.id))
    for (;;) {
      const id = `sp_${crypto.randomBytes(6).toString('hex')}`
      if (!ids.has(id)) return id
    }
  }

  private async describe(space: SpaceRecord, spaces: SpaceRecord[]): Promise<SpaceInfo> {
    const git = await spaceGitInfo(space.path)
    // The worktree's parent is the first space at the main repo's path.
    const main = git.mainPath !== null && git.mainPath !== space.path ? spaces.find((candidate) => candidate.path === git.mainPath) : undefined
    return {
      id: recordSpaceId(space),
      path: space.path,
      name: path.basename(space.path),
      repoName: git.repoName,
      parent: main === undefined ? null : recordSpaceId(main),
      branch: git.branch,
    }
  }
}

function loginShell(): string {
  return process.env.SHELL || '/bin/zsh'
}

// A space whose folder is gone restarts its shells in the home folder; the record is kept.
function rootFor(spacePath: string): string {
  return fs.statSync(spacePath, { throwIfNoEntry: false })?.isDirectory() ? spacePath : os.homedir()
}
