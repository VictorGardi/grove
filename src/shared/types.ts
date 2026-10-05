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
  feature: string | null           // always null in this child
  linkPinned: boolean              // always false in this child
  action: { stage: string; actionId: string } | null // always null
  startedAt: string                // ISO
  endedAt: string | null           // ISO, set when first seen gone
  lastStatus: 'running' | 'gone'
}
export interface UiState { sidebarWidth: number; focusedSessionId: string | null }
export interface FeatureStage {
  id: string
  label: string
  artifact: string
  review: string | null
  state: 'complete' | 'current' | 'upcoming'
}
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
}
export interface FeaturesSlice {
  workflowError: string | null
  stages: { id: string; label: string }[] // all workflow stages, in order
  items: Feature[]
}
export type Slices = { projects: Project[]; sessions: Session[]; ui: UiState; features: FeaturesSlice }
export interface ConfigFile { schemaVersion: 1; projects: Project[] }
export interface StateFile { schemaVersion: 1; sessions: Session[]; ui: UiState }
export const DEFAULT_UI: UiState = { sidebarWidth: 230, focusedSessionId: null }
export const EMPTY_FEATURES: FeaturesSlice = { workflowError: null, stages: [], items: [] }
