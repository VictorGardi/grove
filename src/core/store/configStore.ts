import type { ConfigFile } from '@shared/types'
import { atomicWrite, readVersioned } from './jsonFile'

export function loadConfig(file: string, onBad?: (msg: string) => void): ConfigFile {
  return readVersioned<ConfigFile>(file, 1, { schemaVersion: 1, projects: [] }, onBad)
}

export function saveConfig(file: string, cfg: ConfigFile): void {
  atomicWrite(file, JSON.stringify(cfg, null, 2) + '\n')
}
