import { DEFAULT_UI, type StateFile, type UiState } from '@shared/types'
import { atomicWrite, readVersioned } from './jsonFile'

export function loadState(file: string, onBad?: (msg: string) => void): StateFile {
  const s = readVersioned<StateFile>(file, 1, { schemaVersion: 1, sessions: [], ui: DEFAULT_UI }, onBad)
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
