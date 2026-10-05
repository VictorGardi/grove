import { DEFAULT_UI, type StateFile } from '@shared/types'
import { atomicWrite, readVersioned } from './jsonFile'

export function loadState(file: string, onBad?: (msg: string) => void): StateFile {
  const s = readVersioned<StateFile>(file, 1, { schemaVersion: 1, sessions: [], ui: DEFAULT_UI }, onBad)
  return { ...s, sessions: s.sessions ?? [], ui: s.ui ?? DEFAULT_UI }
}

export function saveState(file: string, s: StateFile): void {
  atomicWrite(file, JSON.stringify(s, null, 2) + '\n')
}
