import type { Closer, Watchers } from '../discovery/watcher'

// Records each watch so a test can fire its callback by hand.
export class FakeWatchers implements Watchers {
  roots = new Map<string, (slug: string) => void>()
  files = new Map<string, () => void>()

  watchRoot(root: string, onFolder: (slug: string) => void): Closer {
    this.roots.set(root, onFolder)
    return { close: async () => { this.roots.delete(root) } }
  }

  watchFile(file: string, onChange: () => void): Closer {
    this.files.set(file, onChange)
    return { close: async () => { this.files.delete(file) } }
  }
}
