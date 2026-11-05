import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { watchConfig } from './watch.ts'
import { ConfigStore } from './store.ts'
import type { ConfigSnapshot } from '../../protocol/messages.ts'

describe('config watch', () => {
  let root: string
  let dir: string
  let store: ConfigStore
  let stop: (() => void) | undefined

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-watch-'))
    dir = path.join(root, 'config')
    store = new ConfigStore(dir)
    store.load()
  })

  afterEach(() => {
    stop?.()
    stop = undefined
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('sends the new snapshot within 5 seconds of an edit', async () => {
    const seen = new Promise<ConfigSnapshot>((resolve) => {
      stop = watchConfig(store, resolve)
    })
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ version: 1, sidebarWidth: 300 }))
    const snapshot = await Promise.race([
      seen,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no change within 5 s')), 5000)),
    ])
    expect(snapshot.values.settings).toEqual({ sidebarWidth: 300 })
  }, 10000)

  it('does not send anything for a file that is not a config file', async () => {
    let calls = 0
    stop = watchConfig(store, () => calls++)
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# other\n')
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(calls).toBe(0)
  })

  it('sends a note that appears with a bad edit, and nothing for a repeat of the same bad edit', async () => {
    const snapshots: ConfigSnapshot[] = []
    stop = watchConfig(store, (snapshot) => snapshots.push(snapshot))
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ version: 1, sidebarWidth: 1 }))
    await waitUntil(() => snapshots.length === 1)
    expect(snapshots[0].notes['settings.json']).toMatch(/^settings\.json: sidebarWidth/)
    expect(snapshots[0].values.settings).toEqual({ sidebarWidth: 200 })
  })

  it('stops after the returned function is called', async () => {
    let calls = 0
    const unwatch = watchConfig(store, () => calls++)
    unwatch()
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ version: 1, sidebarWidth: 300 }))
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(calls).toBe(0)
  })
})

async function waitUntil(done: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
}
