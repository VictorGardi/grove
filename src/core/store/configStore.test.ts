import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ConfigFile } from '@shared/types'
import { loadConfig, saveConfig } from './configStore'

describe('configStore', () => {
  it('round-trips the workflow path', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-')), 'config.json')
    const cfg: ConfigFile = { schemaVersion: 1, projects: [], workflow: '~/w.yaml' }
    saveConfig(file, cfg)
    expect(loadConfig(file)).toEqual(cfg)
  })
})
