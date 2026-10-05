import path from 'node:path'
import { watch } from 'chokidar'

export interface Closer { close(): Promise<void> }
export interface Watchers {
  // One event per changed feature folder (its slug), coalesced.
  watchRoot(root: string, onFolder: (slug: string) => void): Closer
  // Fires on create, change and delete; the file need not exist yet.
  watchFile(file: string, onChange: () => void): Closer
}

const awaitWriteFinish = { stabilityThreshold: 200, pollInterval: 50 }
const COALESCE_MS = 50

export const chokidarWatchers: Watchers = {
  watchRoot(root, onFolder) {
    const ignored = (p: string) =>
      p.endsWith('.tmp') || path.relative(root, p).split(path.sep).some((seg) => seg.startsWith('.'))
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const w = watch(root, { ignoreInitial: true, depth: 1, awaitWriteFinish, ignored })
    w.on('all', (_event, p) => {
      const slug = path.relative(root, p).split(path.sep)[0]
      if (!slug) return
      clearTimeout(timers.get(slug))
      timers.set(slug, setTimeout(() => {
        timers.delete(slug)
        onFolder(slug)
      }, COALESCE_MS))
    })
    w.on('error', (e) => console.warn(`watch ${root}:`, (e as Error).message))
    return {
      close() {
        for (const t of timers.values()) clearTimeout(t)
        timers.clear()
        return w.close()
      },
    }
  },

  watchFile(file, onChange) {
    const w = watch(file, { ignoreInitial: true, awaitWriteFinish })
    w.on('all', () => onChange())
    w.on('error', (e) => console.warn(`watch ${file}:`, (e as Error).message))
    return { close: () => w.close() }
  },
}
