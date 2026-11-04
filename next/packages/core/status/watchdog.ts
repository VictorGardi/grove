import { SILENCE_MS, unknownStatus, type Status, type TimingOptions } from './contract.ts'

export interface WatchdogOptions extends TimingOptions {
  clock: () => number
}

// Two silences, one per kind of state. A working tab is silent when nothing real has happened for the
// silence threshold: no spool record and no change in the normalised screen (progress). The reader's
// heartbeat never counts for it, or a quiet tool run would look busy forever. Every other state is
// silent when the reader has stopped heartbeating, so a quiet needs-you, idle or finished tab is kept
// while the reader still runs.
export class Watchdog {
  private status: Status | null = null
  private heartbeatAt = 0
  private progressAt = 0
  private readonly silenceMs: number

  constructor(private readonly options: WatchdogOptions) {
    this.silenceMs = options.silenceMs ?? SILENCE_MS
  }

  // Call after every status change, with the status as it now is.
  observe(status: Status): void {
    this.status = status
  }

  // The reader's heartbeat: called after each successful drain of the source.
  heartbeat(now: number = this.options.clock()): void {
    this.heartbeatAt = now
  }

  // Real activity: a spool record, or a change in the normalised screen of a working tab.
  progress(now: number = this.options.clock()): void {
    this.progressAt = now
  }

  // Returns unknown once the silence threshold has passed for the status's kind of silence, or null.
  check(now: number = this.options.clock()): Status | null {
    const status = this.status
    if (status === null || status.state === 'unknown') return null
    const last = status.state === 'working' ? this.progressAt : this.heartbeatAt
    if (now - last < this.silenceMs) return null
    this.status = unknownStatus(now)
    return this.status
  }
}

export function createWatchdog(options: WatchdogOptions): Watchdog {
  return new Watchdog(options)
}
