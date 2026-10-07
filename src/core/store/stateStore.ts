import { DEFAULT_UI, type Session, type StateFile, type UiState } from '@shared/types'
import { atomicWrite, readVersioned } from './jsonFile'

type V1Session = Omit<Session, 'agentSessionId'> & { opencodeSessionId?: string | null }

// v1 → v2 (ADR 0017): opencodeSessionId becomes the agent-neutral agentSessionId.
const v1ToV2 = (s: { sessions?: V1Session[] }) => ({
  ...s,
  sessions: (s.sessions ?? []).map(({ opencodeSessionId, ...x }) => ({ ...x, agentSessionId: opencodeSessionId ?? null })),
})

// v2 → v3 (D5): the viewer becomes a tagged union; a saved artifact gains its kind.
const v2ToV3 = (s: { ui?: { viewer?: Record<string, unknown> | null } }) => {
  const viewer = s.ui?.viewer
  if (!viewer || 'kind' in viewer) return s
  return { ...s, ui: { ...s.ui, viewer: { kind: 'artifact', ...viewer, fromDiff: null } } }
}

export function loadState(file: string, onBad?: (msg: string) => void): StateFile {
  const s = readVersioned<StateFile>(file, 3, { schemaVersion: 3, sessions: [], ui: DEFAULT_UI }, onBad, { 1: v1ToV2, 2: v2ToV3 })
  const sessions = (s.sessions ?? []).map((x) => ({ ...x, seenAt: x.seenAt ?? null })) // seenAt: added after v1 shipped
  // v1 files from before ADR 0018 carry `view` and may have the old features tab
  const { view: _view, ...saved } = (s.ui ?? {}) as Partial<UiState> & { view?: unknown }
  const ui = { ...DEFAULT_UI, ...saved }
  if ((ui.sidebarTab as string) === 'features') ui.sidebarTab = 'projects'
  return { ...s, sessions, ui }
}

export function saveState(file: string, s: StateFile): void {
  atomicWrite(file, JSON.stringify(s, null, 2) + '\n')
}
