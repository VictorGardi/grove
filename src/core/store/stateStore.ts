import { DEFAULT_UI, type Session, type StateFile, type UiState } from '@shared/types'
import { pruneGrid } from '@shared/grid'
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

// v3 → v4 (ADR 0029): sessions can start in a folder inside their project; existing ones start at the project path.
const v3ToV4 = (s: { sessions?: Session[] }) => ({ ...s, sessions: (s.sessions ?? []).map((x) => ({ ...x, cwd: null })) })

// v4 → v5 (context gauge): sessions keep their last known context reading; none yet.
const v4ToV5 = (s: { sessions?: Session[] }) => ({ ...s, sessions: (s.sessions ?? []).map((x) => ({ ...x, lastContext: null })) })

// v5 → v6 (ADR 0032): the slug-keyed artifact viewer target is gone; one saved is closed.
const v5ToV6 = (s: { ui?: { viewer?: { kind?: string } | null } }) =>
  s.ui?.viewer?.kind === 'artifact' ? { ...s, ui: { ...s.ui, viewer: null } } : s

// v6 → v7: 480px was the old default; null now means the responsive one-third width.
const v6ToV7 = (s: { ui?: { viewerWidth?: number | null } }) => ({
  ...s,
  ui: s.ui ? { ...s.ui, viewerWidth: s.ui.viewerWidth == null || s.ui.viewerWidth === 480 ? null : s.ui.viewerWidth } : s.ui,
})

// v7 → v8 (session workflow status): every session gets a manual label; none set yet.
const v7ToV8 = (s: { sessions?: Session[] }) => ({
  ...s,
  sessions: (s.sessions ?? []).map((x) => ({ ...x, workflowStatus: x.workflowStatus ?? 'in-progress' })),
})

export function loadState(file: string, onBad?: (msg: string) => void): StateFile {
  const s = readVersioned<StateFile>(file, 8, { schemaVersion: 8, sessions: [], ui: DEFAULT_UI }, onBad, { 1: v1ToV2, 2: v2ToV3, 3: v3ToV4, 4: v4ToV5, 5: v5ToV6, 6: v6ToV7, 7: v7ToV8 })
  const sessions = (s.sessions ?? []).map((x) => ({ ...x, seenAt: x.seenAt ?? null })) // seenAt: added after v1 shipped
  // v1 files from before ADR 0018 carry `view` and may have the old features tab
  const { view: _view, ...saved } = (s.ui ?? {}) as Partial<UiState> & { view?: unknown }
  const ui = { ...DEFAULT_UI, ...saved }
  if ((ui.sidebarTab as string) === 'features') ui.sidebarTab = 'projects'
  // a diff, or "← Diff", of a session that's no longer listed
  const v = ui.viewer
  const known = (id: string) => sessions.some((x) => x.id === id)
  if (v?.kind === 'diff' && !known(v.sessionId)) ui.viewer = null
  else if (v && v.kind !== 'diff' && v.fromDiff && !known(v.fromDiff)) ui.viewer = { ...v, fromDiff: null }
  ui.grid = pruneGrid(ui.grid ?? DEFAULT_UI.grid, known)
  return { ...s, sessions, ui }
}

export function saveState(file: string, s: StateFile): void {
  atomicWrite(file, JSON.stringify(s, null, 2) + '\n')
}
