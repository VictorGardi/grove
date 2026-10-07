import type { SessionDiff } from '@shared/types'

export interface DiffWatch {
  target(id: string | null): void // the session whose diff is on screen; null: none
  poke(): void // recompute now; while a run is in flight, queue one rerun
  dispose(): void
}

// Single-flight recompute of the diff on screen; onChange only when the key changed (D4).
export function createDiffWatch(
  run: (sessionId: string) => Promise<{ key: string; diff: SessionDiff }>,
  onChange: (d: SessionDiff | null) => void,
): DiffWatch {
  let current: string | null = null
  let lastKey: string | null = null
  let running = false
  let rerun = false
  let disposed = false

  async function loop(): Promise<void> {
    running = true
    try {
      do {
        rerun = false
        const id = current!
        let r: { key: string; diff: SessionDiff } | null = null
        try {
          r = await run(id)
        } catch {
          // treated as no change; the next poke retries
        }
        if (r && !disposed && current === id && r.key !== lastKey) {
          lastKey = r.key
          onChange(r.diff)
        }
      } while (rerun && current && !disposed)
    } finally {
      running = false
    }
  }

  function poke(): void {
    if (!current || disposed) return
    if (running) rerun = true
    else void loop()
  }

  return {
    target(id) {
      if (id === current) return
      current = id
      lastKey = null
      onChange(null)
      if (id) poke()
    },
    poke,
    dispose() {
      disposed = true
    },
  }
}
