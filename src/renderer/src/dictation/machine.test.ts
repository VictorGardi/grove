import { describe, expect, it } from 'vitest'
import { IDLE, step, type DictationInput, type DictationState } from './machine'

const down = (o: Partial<Extract<DictationInput, { type: 'keyDown' }>> = {}): DictationInput =>
  ({ type: 'keyDown', ctrl: true, shift: true, alt: false, meta: false, code: 'Space', repeat: false, id: 'a', ...o })
const listening: DictationState = { phase: 'listening', id: 'a' }

describe('dictation machine', () => {
  it('starts on the chord and locks the id', () => {
    expect(step(IDLE, down())).toEqual({ state: listening, effect: { type: 'start' } })
  })

  it('stays idle without a focused session or a full chord', () => {
    expect(step(IDLE, down({ id: null })).state).toEqual(IDLE)
    expect(step(IDLE, down({ shift: false })).state).toEqual(IDLE)
    expect(step(IDLE, down({ alt: true })).state).toEqual(IDLE)
    expect(step(IDLE, down({ code: 'KeyA' })).state).toEqual(IDLE)
  })

  it('ignores auto-repeat and keeps the locked id when focus moves', () => {
    expect(step(listening, down({ repeat: true }))).toEqual({ state: listening })
    expect(step(listening, down({ id: 'b' }))).toEqual({ state: listening })
  })

  it('ends on release of any chord key, transcribing the locked id', () => {
    for (const [key, code] of [['Control', 'ControlLeft'], ['Shift', 'ShiftLeft'], [' ', 'Space']]) {
      expect(step(listening, { type: 'keyUp', key, code })).toEqual({
        state: { phase: 'transcribing', id: 'a' }, effect: { type: 'stop', id: 'a' },
      })
    }
    expect(step(listening, { type: 'keyUp', key: 'a', code: 'KeyA' })).toEqual({ state: listening })
    expect(step(IDLE, { type: 'keyUp', key: 'Shift', code: 'ShiftLeft' })).toEqual({ state: IDLE })
  })

  it('cancels while listening on blur, hidden and explicit cancel', () => {
    for (const type of ['blur', 'visibilityHidden', 'cancel'] as const) {
      expect(step(listening, { type })).toEqual({ state: IDLE, effect: { type: 'abort' } })
    }
  })

  it('does not cancel transcription on blur, but explicit cancel drops it', () => {
    const t: DictationState = { phase: 'transcribing', id: 'a' }
    expect(step(t, { type: 'blur' })).toEqual({ state: t })
    expect(step(t, { type: 'cancel' }).state).toEqual(IDLE)
    expect(step(t, down({ id: 'b' }))).toEqual({ state: t })
  })

  it('dictates the text into the locked id, and types nothing on empty text or failure', () => {
    const t: DictationState = { phase: 'transcribing', id: 'a' }
    expect(step(t, { type: 'transcribed', text: 'hello' })).toEqual({ state: IDLE, effect: { type: 'dictate', id: 'a', text: 'hello' } })
    expect(step(t, { type: 'transcribed', text: '  ' })).toEqual({ state: IDLE })
    expect(step(t, { type: 'failed' })).toEqual({ state: IDLE, effect: undefined })
    expect(step(listening, { type: 'failed' }).effect).toEqual({ type: 'abort' })
    expect(step(IDLE, { type: 'transcribed', text: 'late' })).toEqual({ state: IDLE })
  })
})
