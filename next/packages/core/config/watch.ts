import fs from 'node:fs'
import { FILES, type ConfigFile } from './schema.ts'
import type { ConfigStore } from './store.ts'
import type { ConfigSnapshot } from '../../protocol/messages.ts'

const DEBOUNCE_MS = 150

// Watches the config folder. Edits to the five files are re-read after a short quiet period, and onChange gets the
// snapshot only when a value or a note changed. Returns the function that stops the watch.
export function watchConfig(store: ConfigStore, onChange: (snapshot: ConfigSnapshot) => void): () => void {
  const pending = new Set<ConfigFile>()
  let all = false
  let timer: NodeJS.Timeout | undefined
  const flush = () => {
    timer = undefined
    const names = all ? FILES : [...pending]
    pending.clear()
    all = false
    const before = JSON.stringify(store.snapshot())
    store.reload(names)
    const after = store.snapshot()
    if (JSON.stringify(after) !== before) onChange(after)
  }
  const watcher = fs.watch(store.dir, (_event, filename) => {
    if (filename === null) all = true
    else if ((FILES as readonly string[]).includes(filename)) pending.add(filename as ConfigFile)
    else return
    clearTimeout(timer)
    timer = setTimeout(flush, DEBOUNCE_MS)
  })
  watcher.on('error', (error) => console.error(`config folder watch stopped: ${error.message}`))
  return () => {
    clearTimeout(timer)
    watcher.close()
  }
}
