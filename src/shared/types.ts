export interface Project { id: string; name: string; path: string }
export type SessionKind = 'opencode' | 'terminal'
export interface Session {
  id: string
  projectId: string
  kind: SessionKind
  label: string
  labelPinned: boolean
  tmuxName: string                 // `grove-${id}`
  opencodeSessionId: string | null // set for kind 'opencode' (slice 3)
  feature: string | null           // linked feature slug in this project
  linkPinned: boolean              // true once set by hand; auto-linking (child 3) leaves it alone
  action: { stage: string; actionId: string } | null // always null
  startedAt: string                // ISO
  endedAt: string | null           // ISO, set when first seen gone
  lastStatus: 'running' | 'gone'
  branch?: string | null           // live sessions: branch at the pane's current directory; never saved
}
export interface ViewerTarget {
  projectId: string
  slug: string
  path: string        // relative POSIX path inside the feature folder
  hash: string | null // fragment without the leading '#'
}
export interface UiState {
  sidebarWidth: number
  focusedSessionId: string | null
  focusedFeature: { projectId: string; slug: string } | null // exclusive with focusedSessionId
  view: 'list' | 'board'
  sidebarTab: 'sessions' | 'features'
  collapsed: string[] // tree keys: p:<projectId>, f:<projectId>/<slug>
  viewer: ViewerTarget | null // artifact open in the right-hand panel
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
  artifacts: { name: string; stage: string | null; role: 'artifact' | 'review' | null }[]
}
export interface FeaturesSlice {
  workflowError: string | null
  stages: { id: string; label: string }[] // all workflow stages, in order
  items: Feature[]
}
export type Slices = { projects: Project[]; sessions: Session[]; ui: UiState; features: FeaturesSlice }
export interface ConfigFile { schemaVersion: 1; projects: Project[]; workflow?: string }
export interface StateFile { schemaVersion: 1; sessions: Session[]; ui: UiState }
export const DEFAULT_UI: UiState = { sidebarWidth: 230, focusedSessionId: null, focusedFeature: null, view: 'list', sidebarTab: 'sessions', collapsed: [], viewer: null }
export const EMPTY_FEATURES: FeaturesSlice = { workflowError: null, stages: [], items: [] }
