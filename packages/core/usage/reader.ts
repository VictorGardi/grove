import type { UsageAgent } from '../../protocol/messages.ts'
import type { UsageRequest } from './history.ts'

// The contract every agent's usage reader keeps, so a new one (Copilot, OpenCode on Copilot's models) is one more reader and the
// service, the history and the panel stay as they are. A reader keeps its own place in the agent's files and reads only what is new.
export interface UsageReader {
  agent: UsageAgent
  // Reads one small slice of what is new and returns the requests in it. `done` is true when nothing is left for now; the next
  // call then starts a new pass and looks for what the agent wrote since. A slice does bounded work, so the caller can yield
  // between slices and the core's event loop is never held for long. Records that are repeated, partial or copied may come back
  // more than once: the history merges them by key.
  step(): Promise<{ requests: UsageRequest[]; done: boolean }>
  // Where the reader is in the agent's files, to be saved with the history, and given back to `restore` after a restart.
  state(): unknown
  restore(state: unknown): void
  // Moves past everything the agent's files hold now, without reading it. A wipe uses it, so the old files are not read again.
  skipToEnd(): Promise<void>
}
