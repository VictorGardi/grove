export interface Project { id: string; name: string; path: string }
export type SessionKind = 'opencode' | 'claude' | 'terminal'
export interface Session {
  id: string
  projectId: string
  kind: SessionKind
  label: string
  labelPinned: boolean
  tmuxName: string                 // `grove-${id}`
  cwd: string | null               // folder the session starts in; null: the project's path
  agentSessionId: string | null    // set for agent kinds (opencode, claude)
  feature: string | null           // linked feature slug in this project
  linkPinned: boolean              // true once set by hand; auto-linking (child 3) leaves it alone
  action: { stage: string; actionId: string } | null // always null
  startedAt: string                // ISO
  endedAt: string | null           // ISO, set when first seen gone
  lastStatus: 'running' | 'gone'
  seenAt: string | null           // ISO, when the human last saw it (on screen); persisted
  branch?: string | null           // live sessions: branch at the pane's current directory; never saved
  status?: 'working' | 'waiting' | 'idle' // OpenCode sessions while the service is connected; never saved
  waitingFor?: 'permission' | 'question' | 'done' // with status 'waiting'; never saved
}
export interface ArtifactTarget { kind: 'artifact'; projectId: string; slug: string; path: string; hash: string | null; fromDiff: string | null }
// a viewable file anywhere in the project folder (ADR 0022); path relative POSIX
export interface FileTarget { kind: 'file'; projectId: string; path: string; hash: string | null; fromDiff: string | null }
export interface DiffTarget { kind: 'diff'; sessionId: string }
export type DocTarget = ArtifactTarget | FileTarget // what the iframe viewer shows; hash: fragment without '#'
export type ViewerTarget = DocTarget | DiffTarget // fromDiff: the session the file was opened from ("← Diff")
// A session's `git diff HEAD` plus untracked files, parsed in core (ADR 0021).
export interface SessionDiff {
  sessionId: string
  projectId: string
  state: 'ok' | 'not-git' | 'error'
  error: string | null // git's message, or 'timed out'
  root: string | null  // repo top level
  files: DiffFile[]
  truncated: boolean   // total over the line cap
}
export interface DiffFile {
  path: string           // POSIX, relative to root; the new path for renames
  oldPath: string | null // renames only
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  binary: boolean
  additions: number
  deletions: number
  hunks: DiffHunk[]      // binary: no hunks
  truncated: boolean     // over 1 MB: hunks cut
  rendered: { slug: string | null; path: string } | null // opens in the viewer; slug null: project file
}
export interface DiffHunk { header: string; oldStart: number; newStart: number; lines: DiffLine[] }
// Line identity: (path, side, number) — add → new, del → old, context → new.
export interface DiffLine { kind: 'context' | 'add' | 'del'; text: string; old: number | null; new: number | null }
export interface UiState {
  sidebarWidth: number
  focusedSessionId: string | null
  focusedFeature: { projectId: string; slug: string } | null
  focusedProject: string | null // the project page; the three focuses are exclusive (ADR 0018)
  sidebarTab: 'sessions' | 'projects'
  board: 'features' | 'sessions' // what the project page's board shows
  collapsed: string[] // collapsed project folders on the Sessions tab: p:<projectId>
  viewer: ViewerTarget | null // what the right-hand panel shows
  viewerWidth: number
  viewerExpanded: boolean     // the viewer fills the content area
}
export interface FeatureStage {
  id: string
  label: string
  artifact: string
  review: string | null
  state: 'complete' | 'current' | 'unapproved' | 'upcoming'
}
export type CardState = 'backlog' | 'running' | 'waiting' | 'needs-review' | 'ready' | 'active' | 'done'
export interface Feature {
  projectId: string
  slug: string
  path: string
  title: string
  kind: string
  group: boolean
  parent: string | null
  flow: string | null
  stages: FeatureStage[]          // effective stages only
  currentStage: string | null     // null when done
  cardState: CardState
  progress: { done: number; total: number } | null // group kinds with children only
  flags: { id: string; label: string }[]
  warnings: string[]              // e.g. 'flow?', 'frontmatter?: 03-design.md'
  artifacts: { name: string; stage: string | null; role: 'artifact' | 'review' | null; mtimeMs: number }[]
}
export interface FeaturesSlice {
  workflowError: string | null
  stages: { id: string; label: string }[] // all workflow stages, in order
  items: Feature[]
}
export interface OpenCodeSlice { state: 'connecting' | 'connected' | 'unreachable'; version: string | null } // not persisted
// A review comment (ADR 0024, 0025): a draft in a session's tray until it is sent.
export type CommentAnchor =
  | { kind: 'diff'; root: string; path: string; side: 'old' | 'new'; start: number; end: number; lines: string[] }
  | { kind: 'artifact'; projectId: string; slug: string; path: string; exact: string; prefix: string; suffix: string; start: number; end: number }
  | { kind: 'note' } // at most one draft note per session
export interface Comment {
  id: string
  sessionId: string
  anchor: CommentAnchor
  body: string
  state: 'draft' | 'sent'
  orphaned: boolean
  createdAt: string // ISO
  updatedAt: string // ISO
  sentAt: string | null // ISO
}
export interface CommentsFile { schemaVersion: 1; comments: Comment[] }
export type Slices = { projects: Project[]; sessions: Session[]; ui: UiState; features: FeaturesSlice; opencode: OpenCodeSlice; diff: SessionDiff | null; comments: Comment[] } // diff: the one on screen, not persisted
export interface ConfigFile { schemaVersion: 1; projects: Project[]; workflow?: string }
export interface StateFile { schemaVersion: 4; sessions: Session[]; ui: UiState }
export const SIDEBAR_WIDTH = 220 // fixed: the sidebar has no resize handle, so a saved width is ignored
export const DEFAULT_UI: UiState = { sidebarWidth: SIDEBAR_WIDTH, focusedSessionId: null, focusedFeature: null, focusedProject: null, sidebarTab: 'sessions', board: 'sessions', collapsed: [], viewer: null, viewerWidth: 480, viewerExpanded: false }
export const EMPTY_FEATURES: FeaturesSlice = { workflowError: null, stages: [], items: [] }
export const OPENCODE_CONNECTING: OpenCodeSlice = { state: 'connecting', version: null }
