import type { AgentKind } from '../core/status/adapter.ts'

export const PROTOCOL_VERSION = 1

export const METHODS = {
  corePing: 'core.ping',
  coreRestart: 'core.restart',
  tabsCreate: 'tabs.create',
  tabsList: 'tabs.list',
  tabsWrite: 'tabs.write',
  tabsResize: 'tabs.resize',
  tabsKill: 'tabs.kill',
  tabsAttach: 'tabs.attach',
  tabsOutput: 'tabs.output',
  tabsExit: 'tabs.exit',
  tabsStatus: 'tabs.status',
  spacesList: 'spaces.list',
  spacesAdd: 'spaces.add',
  spacesRemove: 'spaces.remove',
  spacesRename: 'spaces.rename',
  spacesPin: 'spaces.pin',
  worktreesList: 'worktrees.list',
  worktreesAdd: 'worktrees.add',
  tabsOpen: 'tabs.open',
  tabsScreen: 'tabs.screen',
  agentsList: 'agents.list',
  attentionFocus: 'attention.focus',
  tabsClose: 'tabs.close',
  tabsRename: 'tabs.rename',
  tabsFocus: 'tabs.focus',
  configGet: 'config.get',
  configSetKey: 'config.setKey',
  notesRead: 'notes.read',
  notesWrite: 'notes.write',
  diffGet: 'diff.get',
  diffBases: 'diff.bases',
  diffFile: 'diff.file',
  diffPrefsGet: 'diff.prefs.get',
  diffPrefsSet: 'diff.prefs.set',
  diffCommentsList: 'diff.comments.list',
  diffCommentsAdd: 'diff.comments.add',
  diffCommentsUpdate: 'diff.comments.update',
  diffCommentsDelete: 'diff.comments.delete',
  diffCommentsMarkSent: 'diff.comments.markSent',
  integrationStatus: 'integration.status',
  integrationInstall: 'integration.install',
  integrationUninstall: 'integration.uninstall',
  integrationAnswer: 'integration.answer',
  skillsStatus: 'skills.status',
  skillsInstall: 'skills.install',
  skillsUninstall: 'skills.uninstall',
  usageSummary: 'usage.summary',
} as const

export const ERROR_CODES = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  tabNotFound: -32001,
  tabExists: -32002,
  stateRefused: -32003,
  agentMissing: -32004,
  gitRefused: -32005,
  // A create or remove that hit its time limit. Never gitRefused: the UI must not offer "Force remove?" for it.
  gitTimedOut: -32006,
} as const

export type JsonRpcId = number | string

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

export interface JsonRpcFailure {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  error: { code: number; message: string }
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

export type Empty = Record<string, never>

// The usage panel (see GLOSSARY: Request, Usage panel, Usage history). Days are the human's local days, `YYYY-MM-DD`.
export type UsageAgent = 'claude' | 'copilot'

export interface UsageTokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface UsageTotals extends UsageTokens {
  requests: number
  // Copilot's credits for these requests (GitHub AI Credits: 1 credit = 1,000,000,000 nano AIU). Never a dollar figure, never added
  // to anything but other credits; always 0 for an agent without credits.
  credits: number
  // How many of these requests carried no credit figure, so `credits` is partial. Only counted for an agent that has credits.
  withoutCredits: number
}

// One model's share of some requests.
export interface UsageModelTotals extends UsageTotals {
  model: string
}

// One repository's share of some requests. Worktrees are rolled up into their main checkout.
export interface UsageRepositoryTotals extends UsageTotals {
  // The repository's folder name, or null for everything that is no repository and no Space: scratch and temp folders, the home
  // folder, folders with no folder at all.
  name: string | null
  // Whether the repository is a current Space.
  space: boolean
}

// Where requests ran, as the panel splits them. Claude: 'desktop' (Claude Desktop, never run in Grove), 'grove' (Claude Code run in
// Grove), 'other' (Claude Code not tracked by Grove) and 'unknown' (Claude Code from before Grove recorded its sessions: it cannot
// tell). Copilot: 'grove' and 'other' for Copilot CLI, and 'opencode' for the requests OpenCode made on Copilot's models, which are
// not split any further.
export type UsageSplit = 'desktop' | 'grove' | 'other' | 'unknown' | 'opencode'

export interface UsageSplitTotals extends UsageTotals {
  split: UsageSplit
}

export interface UsageDay extends UsageTotals {
  day: string
  // How many of the day's requests helper agents made.
  helperRequests: number
  // The day's requests per model, most requests first.
  models: UsageModelTotals[]
  // The day's requests by where they ran, in the order of UsageSplit; only the splits with a request.
  sources: UsageSplitTotals[]
}

export interface UsageAgentSummary {
  agent: UsageAgent
  // True for an agent that reports credits (Copilot): the credit figures and `withoutCredits` mean something for it.
  hasCredits: boolean
  // The first local day this agent has a request on, over everything its files still hold (not only `days`). A day before it is "no record"
  // for this agent, not zero activity: another agent's files may reach further back than this one's.
  from: string
  // Only the days with a request, oldest first, within the days asked for.
  days: UsageDay[]
  // Today, the last 7 days and the last 30 days, today included.
  today: UsageTotals
  last7: UsageTotals
  last30: UsageTotals
  // The breakdowns below cover the last `range` days (see usage.summary), today included.
  // Requests by weekday and local hour: 168 counts, Monday 00:00 first, `weekday * 24 + hour`.
  hours: number[]
  // Where the requests went, most requests first. Rows of one repository are one row.
  repositories: UsageRepositoryTotals[]
  models: UsageModelTotals[]
  // The requests of the last `range` days by where they ran, in the order of UsageSplit; only the splits with a request.
  sources: UsageSplitTotals[]
  // The day Grove began recording this agent's sessions (the earliest record of its own on this machine), or null when it has
  // none. Only Claude Code's split depends on it: before it Grove cannot tell, so 'unknown'. Always null for Copilot.
  trackedSince: string | null
}

export interface UsageProgress {
  agent: UsageAgent
  fraction: number
}

export interface UsageSummary {
  today: string
  // True while the first read of the agents' files is still running; the numbers are what is ready so far.
  building: boolean
  // The days the history holds requests for so far, or null when it holds none.
  ready: { from: string; to: string } | null
  // How far the first read has got per agent, 0 to 1 (an agent with several sources is as far as its slowest). Empty once the history
  // is built, and for an agent whose reader cannot say.
  progress: UsageProgress[]
  // Agents with a request in the last 30 days. None: nothing to show.
  agents: UsageAgentSummary[]
}

export interface TabInfo {
  id: string
  command: string
  // The folder the shell is in now (listed live by the holder), or where the tab started when the holder cannot tell.
  cwd: string
  alive: boolean
  exitCode: number | null
  status: { state: string; kind?: string } | null
  // The name of the program in the foreground, e.g. `claude`; the shell's own name when nothing else runs; null when gone.
  foreground: string | null
  // The base name the foreground program was run under (the first word of its command line). It can differ from
  // `foreground`: Claude's native install runs as versions/<number>, reached through a link named claude. Null when unknown.
  argv0: string | null
}

export interface SpaceInfo {
  // Opaque, and not a path. Spaces saved before ids existed have their path as their id.
  id: string
  path: string
  // What the sidebar shows: the name the human gave, else the folder's name.
  name: string
  // The name the human gave, or null.
  label: string | null
  repoName: string | null
  // The id of the space the worktree belongs to, or null.
  parent: string | null
  // Whether the folder is a linked worktree of a repo (its main checkout is elsewhere), even when the repo is not a space.
  worktree: boolean
  // The branch checked out in the space; null when detached or when git cannot say.
  branch: string | null
  // When the human pinned the space (epoch ms), or null while it is not pinned. Saved with the space, so it ends with it. The core
  // always sends it; it is optional so a space built without it (a test, the demo) reads as not pinned.
  pinnedAt?: number | null
}

export interface SpaceTabInfo {
  id: string
  spaceId: string
  spacePath: string
  kind: 'terminal' | AgentKind
  label: string | null
  alive: boolean
  exitCode: number | null
}

export type AgentStateName = 'working' | 'needs-you' | 'finished' | 'idle' | 'unknown'

export type NeedsYouReason = 'permission' | 'question' | 'error' | 'auth'

// One reading of an agent's context window. `tokens` is the input-side context in use; it is null, never 0, before the
// agent's first API request and after a compaction, until the next request. `window` and `percent` follow the provider
// and are null when it reported none. `at` is when the reading was taken (epoch ms).
export interface ContextUsage {
  tokens: number | null
  window: number | null
  percent: number | null
  model: string | null
  at: number
}

// How full a context window is: `warn` is no new big work in the tab, `handoff` is time to move the work to a new tab.
export type ContextLevel = 'ok' | 'warn' | 'handoff'

export interface AgentInfo {
  tabId: string
  agent: AgentKind
  state: AgentStateName
  reason?: NeedsYouReason
  since: number
  source: string
  resumable: boolean
  // The latest context reading. Absent until the agent has reported one (and for agents that report none yet).
  context?: ContextUsage
  // The level of that reading; absent with it, and while the reading has no tokens (see contextLevel).
  level?: ContextLevel
  // The session name the agent keeps for this tab's session. Absent until the agent has one. Never a tab's own label.
  name?: string
  // The agent's id for the session the tab runs now (it changes on /clear). Absent until it is known.
  sessionId?: string
}

// A tab that needs the human: entered needs-you (any reason) or finished, and is not on screen.
export interface AttentionNotice {
  tabId: string
  state: 'needs-you' | 'finished'
  reason?: NeedsYouReason
}

// Keys of the key bindings in keys.json.
export type KeyAction =
  | 'grid-toggle'
  | 'new-shell'
  | 'new-grid-shell'
  | 'new-space'
  | 'close-tab'
  | 'previous-tab'
  | 'grid-tab'
  | 'grid-reset-layout'
  | 'next-urgent'
  | 'newest-tab'
  | 'palette'
  | 'sidebar-toggle'
  | 'pin-space'
  | 'notes'
  | 'diff'
  | 'usage'
  | 'dock-expand'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'space-1'
  | 'space-2'
  | 'space-3'
  | 'space-4'
  | 'space-5'
  | 'space-6'
  | 'space-7'
  | 'space-8'
  | 'space-9'
  | 'push-to-talk'

export type LayoutSection = 'spaces' | 'agents'

// A shell line the window can start in the active space (launchers.json).
export interface Launcher {
  id: string
  label: string
  command: string
  args: string[]
  env: Record<string, string>
}

// The validated values of the five config files, one section each.
export interface ConfigValues {
  settings: { sidebarWidth: number }
  keys: Record<KeyAction, string>
  launchers: Launcher[]
  theme: Record<string, string>
  layout: { sidebarOrder: LayoutSection[] }
}

// The values in use, the config folder, and a note per file that does not validate (its last good values stay in use).
export interface ConfigSnapshot {
  path: string
  values: ConfigValues
  notes: Record<string, string>
}

export interface StatusChange {
  tabId: string
  agent: AgentKind
  state: AgentStateName
  reason?: NeedsYouReason
  since: number
  source: string
}

// The agents whose status needs a hook entry in the user's own settings. OpenCode reads its service and needs none.
export type IntegrationAgent = 'claude'

// enabled: every hook event of this version has Grove's entry. not-enabled: no Grove entry. out-of-date: some Grove
// entries, not all of this version's events. unreadable: the settings file is not a JSON object; Grove never touches it.
export type IntegrationState = 'enabled' | 'not-enabled' | 'out-of-date' | 'unreadable'

export interface IntegrationInfo {
  agent: IntegrationAgent
  state: IntegrationState
  // The settings file Grove edits, resolved from the core's environment, and the backup it keeps beside it.
  file: string
  backup: string
  // Whether the app should ask the human to enable this agent now: it is running, has no entry, and nothing is recorded.
  pending: boolean
  error?: string
}

// The agents whose user skill folder Grove can put its skills into.
export type SkillAgent = 'claude' | 'copilot' | 'opencode'

// installed: Grove's skills are there and current. not-installed: none. out-of-date: some missing or changed. blocked: a file or
// link Grove did not write is in the way (or the folder cannot be read); `error` says which. Grove never touches it.
export type SkillState = 'installed' | 'not-installed' | 'out-of-date' | 'blocked'

export interface SkillAgentInfo {
  agent: SkillAgent
  state: SkillState
  // The agent's user skill folder, resolved from the core's environment.
  dir: string
  error?: string
}

export type DiffMode = 'branch' | 'uncommitted' | 'last-commit'

// What the diff was compared against, resolved by the core.
export interface DiffCompared {
  mode: DiffMode
  // The branch the diff is since (a merge-base); null: the working tree against HEAD.
  base: string | null
  // The detected main branch; null with noDefault.
  defaultBase: string | null
  // HEAD is the default branch.
  onDefault: boolean
  // No default branch found (none detected, no ref for it, or a detached or unborn HEAD).
  noDefault: boolean
  // HEAD is the merge-base with the compared branch; false when onDefault.
  noOwnCommits: boolean
}

// Line identity: add -> new side, del -> old side, context -> new side.
export interface DiffLine {
  kind: 'context' | 'add' | 'del'
  text: string
  old: number | null
  new: number | null
}

export interface DiffHunk {
  header: string
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

export interface DiffFile {
  // POSIX, relative to the repo root; the new path for renames.
  path: string
  // Renames only.
  oldPath: string | null
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  binary: boolean
  additions: number
  deletions: number
  // Binary, unreadable or cut files have none.
  hunks: DiffHunk[]
  // Too large to show (over 1 MB, or past the line cap): hunks cut.
  truncated: boolean
}

// `not-git`: the folder is not in a repo. `error`: git refused (its message, or `timed out`); nothing else in the result is meaningful.
export interface DiffResult {
  state: 'ok' | 'not-git' | 'error'
  error: string | null
  // The repo's top level.
  root: string | null
  files: DiffFile[]
  // Some file lost its lines because the total passed the cap.
  truncated: boolean
  compared: DiffCompared
  // How many files each mode shows now, for the tabs. Untracked files count where the mode lists them.
  counts: Record<DiffMode, number>
}

// A file's new side as the diff shows it, for the preview. `missing`: gone, not in the revision, a link or outside the repo.
// `too-large` (over the diff's size cap) and `binary` have no text.
export interface DiffFileContent {
  state: 'ok' | 'too-large' | 'binary' | 'missing'
  text: string | null
}

// What the base picker lists: local branches, then remote-tracking ones as `origin/x`.
export interface DiffBases {
  branches: string[]
  current: string | null
  default: string | null
  recents: string[]
}

// The view remembered for a folder. `base` null: the detected default branch.
export interface DiffPrefs {
  mode: DiffMode
  base: string | null
  recents: string[]
}

// The limits the core keeps on a folder's comments. The window shortens the line it compares to an anchor the same way.
export const DIFF_COMMENT_LIMITS = { body: 10000, line: 500, context: 2, perFolder: 500, path: 4096, range: 100 } as const

// A line comment on a folder's diff. `line` is a line number of the `side` (old: a deleted line; new: an added or context line) and `anchor`
// is that line's text when the comment was written. A comment on several lines has `endLine` (after `line`, at most 100 lines in all, same
// side) and its `anchor` is the lines' texts joined with a newline; without `endLine` it is on the one line. The thread sits under the last line.
// The text is that of the lines when the comment was written, so a later diff can tell the comment no longer fits. `before` and `after` are up to two
// context lines each. `sent` is set only by sending the comment to an agent.
export interface DiffComment {
  id: string
  path: string
  side: 'old' | 'new'
  line: number
  endLine?: number
  anchor: string
  before: string[]
  after: string[]
  body: string
  state: 'pending' | 'sent' | 'resolved'
  createdAt: number
}

// The folder a diff call is about. The caller names a tab or a space and never a path: the core finds the folder itself.
export type DiffTarget = { tabId: string; spaceId?: undefined } | { spaceId: string; tabId?: undefined }

export interface MethodMap {
  // `build` fingerprints the core's own source (the holder sends none): a caller whose build differs is talking to an older core.
  'core.ping': { params: Empty; result: { protocolVersion: number; build?: string } }
  // The core answers, then exits; the holder starts a new one. Running tabs are in the holder and keep running.
  'core.restart': { params: Empty; result: Record<string, never> }
  'tabs.create': {
    params: {
      id?: string
      command: string
      args?: string[]
      cwd: string
      env?: Record<string, string>
      cols: number
      rows: number
      agent?: { kind: AgentKind; resumeId?: string }
      label?: string
      // An agent tab goes in this space instead of the first space at `cwd`.
      spaceId?: string
    }
    result: { id: string }
  }
  'tabs.list': { params: Empty; result: TabInfo[] }
  'tabs.write': { params: { id: string; dataB64: string }; result: Empty }
  'tabs.resize': { params: { id: string; cols: number; rows: number }; result: Empty }
  'tabs.kill': { params: { id: string }; result: Empty }
  'tabs.attach': { params: { id: string }; result: { screenB64: string; cols: number; rows: number } }
  // With `tabsOnly` the spaces come back empty: git is not asked about each folder, for a caller that polls for one tab.
  'spaces.list': {
    params: { tabsOnly?: boolean }
    result: { spaces: SpaceInfo[]; tabs: SpaceTabInfo[]; refused: string | null }
  }
  // Always adds a new space, even when the folder is already one.
  'spaces.add': { params: { path: string }; result: SpaceInfo }
  // Kills the space's tabs and drops it. With `removeWorktree` the checkout is deleted first, and git refuses one with changes
  // in it (the space stays then). Only a worktree is ever deleted, never a main checkout; its branch is kept.
  'spaces.remove': { params: { id: string; removeWorktree?: boolean; force?: boolean }; result: Empty }
  // An empty name clears it, so the space shows its folder's name again.
  'spaces.rename': { params: { id: string; name: string }; result: Empty }
  // Pins or unpins a space. Pinning a pinned space changes nothing, so its place in the pins stays. Fails while the state file is
  // refused. Every window, the asking one too, hears the new state through `spaces.changed`, sent before the answer.
  'spaces.pin': { params: { id: string; pinned: boolean }; result: Empty }
  // The worktrees of the space's repo that are not spaces yet.
  'worktrees.list': { params: { spaceId: string }; result: { worktrees: { path: string; branch: string | null }[] } }
  // A new space on a checkout under ~/.grove/worktrees/<repo>/. A branch that exists is checked out; a new one starts from `base`
  // (any git ref), else the space's HEAD. `base` with a branch that exists is an error.
  'worktrees.add': { params: { spaceId: string; branch: string; base?: string }; result: SpaceInfo }
  'tabs.open': { params: { spaceId: string; cols: number; rows: number; label?: string }; result: { id: string } }
  'tabs.screen': { params: { id: string }; result: { text: string } }
  'agents.list': { params: Empty; result: AgentInfo[] }
  // The tab on screen (null when none) and whether the window has focus.
  'attention.focus': { params: { tabId: string | null; windowFocused: boolean }; result: Empty }
  // Kills the tab in the holder and removes its saved record.
  'tabs.close': { params: { id: string }; result: Empty }
  // An empty label clears the name, so the tab shows its number again.
  'tabs.rename': { params: { id: string; label: string }; result: Empty }
  // Asks every client to show the tab; the window selects it and raises itself.
  'tabs.focus': { params: { id: string }; result: Empty }
  'config.get': { params: Empty; result: ConfigSnapshot }
  // Rebinds one key action. The core checks the binding (syntax, and that no other action has it) and writes only that key
  // into keys.json, keeping the file as it was in keys.json.bak. A refused binding is an error and changes nothing.
  'config.setKey': { params: { action: KeyAction; binding: string }; result: ConfigSnapshot }
  // The notes page: one markdown file under the core's home. A file that does not exist yet reads as empty text.
  'notes.read': { params: Empty; result: { text: string } }
  'notes.write': { params: { text: string }; result: Empty }
  // The diff of the tab's folder (its live folder when the core knows it, else its space's). Read-only: nothing is staged or written.
  // `base` only counts in branch mode; null or unset: the default branch. Untracked files are listed unless `showUntracked` is false.
  'diff.get': { params: DiffTarget & { mode: DiffMode; base?: string | null; showUntracked?: boolean }; result: DiffResult }
  'diff.bases': { params: DiffTarget; result: DiffBases }
  // One file of the diff as it reads after the change: the working tree, or HEAD in last-commit mode. `file` is the diff's path from the
  // repo root. Read only; the window asks when a card is flipped to its preview.
  'diff.file': { params: DiffTarget & { mode: DiffMode; file: string }; result: DiffFileContent }
  // The view last chosen for the folder. A folder never chosen for reads as branch mode against the default.
  'diff.prefs.get': { params: DiffTarget; result: DiffPrefs }
  // Sets the parts given. A non-null base is also put first in the folder's recent bases (five at most).
  'diff.prefs.set': { params: DiffTarget & { mode?: DiffMode; base?: string | null }; result: DiffPrefs }
  // The review comments kept for the folder, oldest first.
  'diff.comments.list': { params: DiffTarget; result: { comments: DiffComment[] } }
  // Adds a pending comment; the core makes the id and the time. Body 1 to 10000 characters, at most 500 comments per folder.
  'diff.comments.add': {
    params: DiffTarget & { path: string; side: 'old' | 'new'; line: number; endLine?: number; anchor: string; before: string[]; after: string[]; body: string }
    result: DiffComment
  }
  // Changes the text or moves a comment between pending and resolved. State `sent` is refused: only sending sets it.
  'diff.comments.update': { params: DiffTarget & { id: string; body?: string; state?: 'pending' | 'resolved' }; result: DiffComment }
  'diff.comments.delete': { params: DiffTarget & { id: string }; result: Empty }
  // Marks pending comments as sent, after the window pasted them to an agent. Ids that are not pending are skipped; the result is the ones that changed.
  'diff.comments.markSent': { params: DiffTarget & { ids: string[] }; result: { comments: DiffComment[] } }
  'integration.status': { params: Empty; result: { agents: IntegrationInfo[] } }
  // The only writer of an agent's settings file, and only on this call (a human's yes). `written` is the backup this change wrote, or null.
  'integration.install': { params: { agent: IntegrationAgent }; result: IntegrationInfo & { changed: boolean; written: string | null } }
  // Removes only Grove's entries; the recorded answer stays, so nothing asks again.
  'integration.uninstall': { params: { agent: IntegrationAgent }; result: IntegrationInfo }
  // Records that the human said not now; nothing is written.
  'integration.answer': { params: { agent: IntegrationAgent; answer: 'not-now' }; result: Empty }
  'skills.status': { params: Empty; result: { agents: SkillAgentInfo[] } }
  // Writes Grove's skills into the agent's user skill folder, only on this call (a human's yes). Refuses a file Grove did not write.
  'skills.install': { params: { agent: SkillAgent }; result: SkillAgentInfo }
  // Removes only the skill files Grove wrote.
  'skills.uninstall': { params: { agent: SkillAgent }; result: SkillAgentInfo }
  // The usage panel's numbers. `days` is how many local days of per-day detail to return (default 30); `range` is how many days the
  // hour, repository and model breakdowns cover (default: `days`).
  'usage.summary': { params: { days?: number; range?: number }; result: UsageSummary }
}

export interface NotificationMap {
  'tabs.output': { id: string; dataB64: string }
  'tabs.exit': { id: string; exitCode: number | null }
  'tabs.status': { id: string; state: string; kind?: string }
  'status.changed': StatusChange
  'context.changed': { tabId: string; context: ContextUsage }
  // The agent named, or renamed, the session a tab runs.
  'agent.named': { tabId: string; name: string }
  'attention.notify': AttentionNotice
  'tabs.focus': { id: string }
  // A tab was closed on purpose: every window drops it.
  'tabs.closed': { id: string }
  // A saved tab was opened or resumed: every window adds it or reattaches it.
  'tabs.opened': SpaceTabInfo
  // A space was removed: every window drops it.
  'spaces.removed': { id: string }
  // A space was added or changed: every window shows its current name and branch.
  'spaces.changed': SpaceInfo
  // The config folder changed and a value or a note is new: every window applies it.
  'config.changed': ConfigSnapshot
  // An agent the app did not start is running and has no hook entry yet: ask the human once.
  'integration.prompt': { agent: IntegrationAgent }
  // The usage numbers changed: ask usage.summary again. Coalesced, never one per request.
  'usage.changed': Empty
}

export type MethodName = keyof MethodMap
