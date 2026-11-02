import { describe, expect, it } from 'vitest'
import { swallowStep, setDictationHold, isDictationKey, type SwallowEvent } from './swallow'

const ev = (type: SwallowEvent['type'], key: string, code: string, chord = false): SwallowEvent => ({ type, key, code, chord })
const run = (events: SwallowEvent[]) => {
  let held = false
  return events.map((e) => { const r = swallowStep(held, e); held = r.held; return r.swallow })
}

describe('dictation swallow', () => {
  it('swallows Space repeats after Ctrl is released, until Space is up, then lets a fresh Space through', () => {
    expect(run([
      ev('keydown', ' ', 'Space', true),
      ev('keyup', 'Control', 'ControlLeft'),
      ev('keydown', ' ', 'Space'), ev('keypress', ' ', 'Space'), ev('keydown', ' ', 'Space'),
      ev('keyup', ' ', 'Space'),
      ev('keydown', ' ', 'Space'), ev('keypress', ' ', 'Space'), ev('keyup', ' ', 'Space'),
    ])).toEqual([true, true, true, true, true, true, false, false, false])
  })

  it('does not swallow unrelated keys during a hold, nor anything without one', () => {
    expect(run([ev('keydown', 'a', 'KeyA'), ev('keydown', ' ', 'Space')])).toEqual([false, false])
    expect(run([ev('keydown', ' ', 'Space', true), ev('keydown', 'a', 'KeyA')])).toEqual([true, false])
  })

  it('ends the hold on Space up even when modifiers are still down', () => {
    expect(run([ev('keydown', ' ', 'Space', true), ev('keyup', ' ', 'Space'), ev('keyup', 'Shift', 'ShiftLeft')])).toEqual([true, true, false])
  })

  it('exposes the hold to the xterm handler', () => {
    setDictationHold(true)
    expect(isDictationKey({ key: ' ', code: 'Space' })).toBe(true)
    expect(isDictationKey({ key: 'a', code: 'KeyA' })).toBe(false)
    setDictationHold(false)
    expect(isDictationKey({ key: ' ', code: 'Space' })).toBe(false)
  })
})
