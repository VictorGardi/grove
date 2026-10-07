import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCore, type Core, type CoreOptions } from '../core'
import { saveConfig } from '../store/configStore'
import { FakeBackend } from './fakeBackend'
import { FakeAgentSource } from './fakeAgentSource'
import { FakeWatchers } from './fakeWatchers'

const bundledWorkflowPath = fileURLToPath(new URL('../../../resources/workflow.yaml', import.meta.url))

export const NOW = new Date('2026-10-05T10:00:00.000Z')
export const LATER = new Date('2026-10-05T11:00:00.000Z')

// A config with one project `p`, a fake backend and a factory for cores on the
// same files. Call disposeAll() in afterEach to clear their poll timers.
export function setupCore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))
  const configPath = path.join(dir, 'config.json')
  const statePath = path.join(dir, 'state.json')
  saveConfig(configPath, { schemaVersion: 1, projects: [{ id: 'p', name: 'proj', path: dir }] })
  const fake = new FakeBackend()
  const watchers = new FakeWatchers()
  const oc = new FakeAgentSource('opencode')
  const claude = new FakeAgentSource('claude', true)
  const claudeDir = path.join(dir, 'agents', 'claude')
  const cores: Core[] = []
  const make = (now = NOW, over: Partial<CoreOptions> = {}) => {
    const core = createCore({
      configPath, statePath, bundledWorkflowPath, watchers, backend: fake, sources: [oc, claude], now: () => now, ...over,
    })
    cores.push(core)
    return core
  }
  const disposeAll = () => { for (const c of cores.splice(0)) c.dispose() }
  return { dir, fake, watchers, oc, claude, make, configPath, statePath, claudeDir, disposeAll }
}

export async function createTerminal(core: Core, projectId = 'p') {
  const res = await core.commands.sessionCreate({ projectId, kind: 'terminal', cols: 80, rows: 24 })
  if (!res.ok) throw new Error(res.error)
  return res.data
}

export async function createOpenCode(core: Core, projectId = 'p') {
  const res = await core.commands.sessionCreate({ projectId, kind: 'opencode', cols: 80, rows: 24 })
  if (!res.ok) throw new Error(res.error)
  return res.data
}

export async function createClaude(core: Core, projectId = 'p') {
  const res = await core.commands.sessionCreate({ projectId, kind: 'claude', cols: 80, rows: 24 })
  if (!res.ok) throw new Error(res.error)
  return res.data
}
