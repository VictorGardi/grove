// Which keyboard events of a dictation hold the app must swallow (pure), plus the flag xterm's key handler reads.
// A hold starts at the chord's keydown and lasts until Space is released: Ctrl or Shift may come up first, and the
// OS then keeps auto-repeating a bare Space that must never reach the pty.
import { isChordKey } from './machine'

export type SwallowEvent = { type: 'keydown' | 'keypress' | 'keyup'; key: string; code: string; chord: boolean }

export function swallowStep(held: boolean, e: SwallowEvent): { held: boolean; swallow: boolean } {
  if (e.type === 'keydown' && e.chord) return { held: true, swallow: true }
  if (!held) return { held, swallow: false }
  const swallow = isChordKey(e.key, e.code)
  return { held: e.type === 'keyup' && e.code === 'Space' ? false : held, swallow }
}

let holding = false
export function setDictationHold(v: boolean): void { holding = v }
// xterm's custom key handler asks this so the held chord's keys never become pty input
export function isDictationKey(e: { key: string; code: string }): boolean { return holding && isChordKey(e.key, e.code) }
