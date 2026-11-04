import { GRACE_MS, unknownStatus, type Status, type TimingOptions } from './contract.ts'

export interface CrossCheckOptions extends TimingOptions {
  clock: () => number
}

// Spinner glyphs (braille block, and Claude's own `✻ ✽ ✶ ✳ ✢ ·`), elapsed timers such as `12s` or `1m 3s`,
// and the token counter `↑ 1.2k tokens`: a spinner redraws these every frame while a hung turn makes no
// progress, so they are not real change. The selection markers at the start of a line are dropped too.
const SPINNER = /[⠀-⣿✻✽✶✳✢·]/g
const TOKENS = /[↑↓]\s?\d+(?:\.\d+)?[km]?\s?tokens\b/g
const TIMER = /\b\d+(?:\.\d+)?\s?(?:ms|s|m|h)\b/g
const SELECTION_MARKER = /^\s*[❯>]\s?/

// Keeps only the real text: no spinner glyphs, token counters, timers, selection marker, blank or padded lines.
export function normaliseScreen(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line.replace(SPINNER, '').replace(TOKENS, '').replace(TIMER, '').replace(SELECTION_MARKER, '').trim(),
    )
    .filter((line) => line !== '')
    .join('\n')
}

// Compares the visible screen with the one seen when a needs-you was raised. The first screen read
// after a needs-you is the baseline, whatever the time; from the grace on, a later screen that differs
// in real text falls to unknown. The grace only delays the comparison. Each call to check() is one tick.
export class CrossCheck {
  private status: Status | null = null
  private baseline: string | null = null
  private readonly graceMs: number

  constructor(private readonly options: CrossCheckOptions) {
    this.graceMs = options.graceMs ?? GRACE_MS
  }

  // Call after every status change, with the status as it now is.
  observe(status: Status): void {
    const previous = this.status
    this.status = status
    const sameEntry = previous?.state === 'needs-you' && status.state === 'needs-you' && previous.since === status.since
    if (!sameEntry) this.baseline = null
  }

  // `screen` is the visible screen read on this tick. Returns unknown when the screen has changed in
  // real text since the baseline, or null.
  check(screen: string, now: number = this.options.clock()): Status | null {
    const status = this.status
    if (status === null || status.state !== 'needs-you') return null
    const text = normaliseScreen(screen)
    if (this.baseline === null) {
      this.baseline = text
      return null
    }
    if (now < status.since + this.graceMs) return null
    if (text === this.baseline) return null
    this.status = unknownStatus(now)
    this.baseline = null
    return this.status
  }
}

export function createCrossCheck(options: CrossCheckOptions): CrossCheck {
  return new CrossCheck(options)
}
