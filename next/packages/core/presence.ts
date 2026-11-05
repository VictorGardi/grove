import type { AgentKind } from './status/adapter.ts'

// The programs Grove knows by name. A tab whose foreground program has one of these names is running that agent,
// whoever started it. Names are the binaries' own (verified on this Mac: claude, opencode and copilot are native
// binaries, so the foreground name is the command name).
const PROGRAMS: Record<string, AgentKind> = { claude: 'claude', opencode: 'opencode', copilot: 'copilot' }

export function agentOfProgram(name: string | null): AgentKind | undefined {
  return name === null ? undefined : PROGRAMS[name]
}

// The root rule: a `cd` in a plain tab moves the space's root to the folder it reached only when no agent tab in the
// space sits in a different folder. Otherwise the root stays and the cd only sets that tab's own folder.
export function nextRoot(root: string, candidate: string, agentFolders: string[]): string {
  return agentFolders.every((folder) => folder === candidate) ? candidate : root
}

// What the presence scan needs from the rest of the core. The daemon wires these to the holder, the spaces and the
// status service; tests give fakes.
export interface PresenceTab {
  id: string
  alive: boolean
  foreground: string | null
  cwd: string
}

export interface PresenceSpace {
  key: string
  root: string
  // Tab ids in the space, in any order.
  members: string[]
}

export interface PresencePorts {
  clock: () => number
  tabs: () => Promise<PresenceTab[]>
  // The space a tab belongs to, or undefined for a tab with no space record.
  spaceOf: (tabId: string) => PresenceSpace | undefined
  // The agent kind saved on a tab's record (launched or found by hand), if any.
  agentRecorded: (tabId: string) => AgentKind | undefined
  // Save or clear the agent kind on a tab's record. A found agent is saved so that a restart restores it.
  setAgent: (tabId: string, kind: AgentKind | undefined) => void
  setRoot: (spaceKey: string, root: string) => void
  // The status service: start a watch for a found agent (sessionId '' until known), or stop an adopted one.
  adopt: (tabId: string, kind: AgentKind, sessionId: string) => void
  identify: (tabId: string, sessionId: string) => void
  release: (tabId: string) => void
  // The kind of a tab the presence scan adopted (not one the app launched), if any.
  adoptedKind: (tabId: string) => AgentKind | undefined
  // Finds the session id of a found agent (OpenCode asks its service); undefined while none.
  discover: (kind: AgentKind, cwd: string, since: number) => Promise<string | undefined>
}

// Looking back this far when a found agent is first seen: an agent started just before the scan is still its session.
const SINCE_SLACK_MS = 2000
// A found agent is released only after its program is seen gone this many ticks in a row. A tool an agent runs can
// briefly take the foreground; releasing on that one reading would drop the agent and restart its status.
const RELEASE_TICKS = 3

// The presence scan. Each tick, for each live tab:
// - an agent in the foreground that the app did not launch is adopted at once as unknown; its session id follows
//   when discover() or its own hook reports it;
// - an adopted agent whose program has ended is released (the tab is a shell again);
// - a cd in a plain tab applies the root rule to its space.
export class Presence {
  // First time each tab's foreground agent was seen, for the discovery window.
  private readonly seenAt = new Map<string, number>()
  // Adopted tabs that do not have their session id yet.
  private readonly awaitingId = new Set<string>()
  private readonly lastCwd = new Map<string, string>()
  // Consecutive ticks in which an adopted tab's foreground was not its agent.
  private readonly missing = new Map<string, number>()

  constructor(private readonly ports: PresencePorts) {}

  async tick(): Promise<void> {
    const tabs = (await this.ports.tabs()).filter((tab) => tab.alive)
    const byId = new Map(tabs.map((tab) => [tab.id, tab]))
    const now = this.ports.clock()

    for (const tab of tabs) {
      const kind = agentOfProgram(tab.foreground)
      const adopted = this.ports.adoptedKind(tab.id)

      if (adopted !== undefined && adopted !== kind) {
        const count = (this.missing.get(tab.id) ?? 0) + 1
        if (count >= RELEASE_TICKS) this.release(tab.id)
        else this.missing.set(tab.id, count)
      } else {
        this.missing.delete(tab.id)
      }

      if (kind !== undefined && this.ports.adoptedKind(tab.id) === undefined && this.ports.agentRecorded(tab.id) === undefined) {
        if (!this.seenAt.has(tab.id)) this.seenAt.set(tab.id, now)
        this.ports.setAgent(tab.id, kind)
        this.ports.adopt(tab.id, kind, '')
        this.awaitingId.add(tab.id)
      }
      if (kind === undefined) this.seenAt.delete(tab.id)

      if (this.awaitingId.has(tab.id)) {
        const kindNow = this.ports.adoptedKind(tab.id)
        if (kindNow !== undefined) {
          const since = (this.seenAt.get(tab.id) ?? now) - SINCE_SLACK_MS
          const sessionId = await this.ports.discover(kindNow, tab.cwd, since)
          if (sessionId !== undefined) {
            this.ports.identify(tab.id, sessionId)
            this.awaitingId.delete(tab.id)
          }
        } else {
          this.awaitingId.delete(tab.id)
        }
      }

      const previous = this.lastCwd.get(tab.id)
      this.lastCwd.set(tab.id, tab.cwd)
      if (previous !== undefined && previous !== tab.cwd && this.plain(tab, kind)) this.applyRootRule(tab, byId)
    }

    // A tab that is gone forgets its state.
    for (const id of [...this.lastCwd.keys()]) if (!byId.has(id)) this.lastCwd.delete(id)
    for (const id of [...this.seenAt.keys()]) if (!byId.has(id)) this.seenAt.delete(id)
    for (const id of [...this.awaitingId]) if (!byId.has(id)) this.awaitingId.delete(id)
  }

  private plain(tab: PresenceTab, kind: AgentKind | undefined): boolean {
    return kind === undefined && this.ports.agentRecorded(tab.id) === undefined && this.ports.adoptedKind(tab.id) === undefined
  }

  private applyRootRule(tab: PresenceTab, byId: Map<string, PresenceTab>): void {
    const space = this.ports.spaceOf(tab.id)
    if (space === undefined) return
    const agentFolders = space.members
      .filter((member) => member !== tab.id && this.ports.agentRecorded(member) !== undefined && byId.has(member))
      .map((member) => byId.get(member)!.cwd)
    const root = nextRoot(space.root, tab.cwd, agentFolders)
    if (root !== space.root) this.ports.setRoot(space.key, root)
  }

  private release(tabId: string): void {
    this.missing.delete(tabId)
    this.ports.release(tabId)
    this.ports.setAgent(tabId, undefined)
    this.awaitingId.delete(tabId)
    this.seenAt.delete(tabId)
  }
}
