import fs from 'node:fs'
import path from 'node:path'
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

// v8 → v9 (ADR 0033): added the per-session `sandboxed` flag. v9 → v10 removes it again, so
// this step has nothing left to do.
const v8ToV9 = (s: object) => s

// v9 → v10 (sandbox removed, ADR 0045): a sandboxed session cannot resume without its sandbox, so
// it is dropped (its children become top level); the rest lose the `sandboxed` field.
const v9ToV10 = (s: { sessions?: (Session & { sandboxed?: boolean; parentId?: string | null })[] }) => {
  const all = s.sessions ?? []
  const gone = all.filter((x) => x.sandboxed).map((x) => x.id)
  const kept = all.filter((x) => !x.sandboxed).map(({ sandboxed: _sandboxed, ...x }) => x)
  // inline on the old `parentId` field: this step predates the typed `link`
  const orphaned = kept.map((x) => (x.parentId && gone.includes(x.parentId) ? { ...x, parentId: null } : x))
  return { ...s, sessions: orphaned }
}

// v10 → v11 (typed session link): `parentId: X` becomes `link: { id: X, kind: 'group' }`; no parent means no link.
const v10ToV11 = (s: { sessions?: (Session & { parentId?: string | null })[] }) => ({
  ...s,
  sessions: (s.sessions ?? []).map(({ parentId, ...x }) => (parentId ? { ...x, link: { id: parentId, kind: 'group' as const } } : x)),
})

// Before a v10 file is migrated to v11, keep a copy of it once as state.v10.bak.
function backUpV10(file: string): void {
  const bak = path.join(path.dirname(file), 'state.v10.bak')
  try {
    if (fs.existsSync(bak)) return
    if (JSON.parse(fs.readFileSync(file, 'utf8'))?.schemaVersion === 10) fs.copyFileSync(file, bak)
  } catch {
    // missing or unreadable: readVersioned reports it
  }
}

export function loadState(file: string, onBad?: (msg: string) => void): StateFile {
  backUpV10(file)
  const s = readVersioned<StateFile>(file, 11, { schemaVersion: 11, sessions: [], ui: DEFAULT_UI }, onBad, { 1: v1ToV2, 2: v2ToV3, 3: v3ToV4, 4: v4ToV5, 5: v5ToV6, 6: v6ToV7, 7: v7ToV8, 8: v8ToV9, 9: v9ToV10, 10: v10ToV11 })
  const sessions = (s.sessions ?? []).map((x) => ({ ...x, seenAt: x.seenAt ?? null })) // seenAt: added after v1 shipped
  // v1 files from before ADR 0018 carry `view`; files from before the sidebar lost its Projects tab carry `sidebarTab`
  const { view: _view, sidebarTab: _sidebarTab, ...saved } = (s.ui ?? {}) as Partial<UiState> & { view?: unknown; sidebarTab?: unknown }
  const ui = { ...DEFAULT_UI, ...saved }
  // the old "Default" sort was created-asc under another name; custom order reads the same until a card is dragged (ADR 0041)
  if ((ui.sessionSort as string) === 'none') ui.sessionSort = 'custom'
  // a diff, or "← Diff", of a session that's no longer listed
  const v = ui.viewer
  const known = (id: string) => sessions.some((x) => x.id === id)
  if (v?.kind === 'diff' && !known(v.sessionId)) ui.viewer = null
  else if (v && v.kind !== 'diff' && v.fromDiff && !known(v.fromDiff)) ui.viewer = { ...v, fromDiff: null }
  if (ui.diffPrefs) ui.diffPrefs = Object.fromEntries(Object.entries(ui.diffPrefs).filter(([id]) => known(id)))
  // the artifact page is a place the human went, not one to come back to on launch
  ui.focusedArtifact = null
  ui.grid = pruneGrid(ui.grid ?? DEFAULT_UI.grid, known)
  return { ...s, sessions, ui }
}

export function saveState(file: string, s: StateFile): void {
  const sessions = s.sessions.map(({ startup: _startup, ...x }) => x) // startup is live-only
  atomicWrite(file, JSON.stringify({ ...s, sessions }, null, 2) + '\n')
}
