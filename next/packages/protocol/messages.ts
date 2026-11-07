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

export interface AgentInfo {
  tabId: string
  agent: AgentKind
  state: AgentStateName
  reason?: NeedsYouReason
  since: number
  source: string
  resumable: boolean
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
  | 'new-space'
  | 'close-tab'
  | 'previous-tab'
  | 'grid-tab'
  | 'next-urgent'
  | 'sidebar-toggle'
  | 'notes'
  | 'diff'
  | 'space-1'
  | 'space-2'
  | 'space-3'
  | 'space-4'
  | 'space-5'
  | 'space-6'
  | 'space-7'
  | 'space-8'
  | 'space-9'

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
  // The worktrees of the space's repo that are not spaces yet.
  'worktrees.list': { params: { spaceId: string }; result: { worktrees: { path: string; branch: string | null }[] } }
  // A new space on a checkout under ~/.grove/worktrees/<repo>/. A branch that exists is checked out; a new one starts from the space's HEAD.
  'worktrees.add': { params: { spaceId: string; branch: string }; result: SpaceInfo }
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
}

export interface NotificationMap {
  'tabs.output': { id: string; dataB64: string }
  'tabs.exit': { id: string; exitCode: number | null }
  'tabs.status': { id: string; state: string; kind?: string }
  'status.changed': StatusChange
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
}

export type MethodName = keyof MethodMap
