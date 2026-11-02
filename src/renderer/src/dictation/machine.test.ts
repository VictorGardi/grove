import { describe, expect, it } from 'vitest'
import { dictationMessage, errorKind, IDLE, step, type DictationInput, type DictationState } from './machine'

const down = (o: Partial<Extract<DictationInput, { type: 'keyDown' }>> = {}): DictationInput =>
  ({ type: 'keyDown', ctrl: true, shift: true, alt: false, meta: false, code: 'Space', repeat: false, id: 'a', ...o })
const listening: DictationState = { phase: 'listening', id: 'a' }
const err: DictationState = { phase: 'error', id: 'a', kind: 'failed' }

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

  it('dictates the text into the locked id', () => {
    const t: DictationState = { phase: 'transcribing', id: 'a' }
    expect(step(t, { type: 'transcribed', text: 'hello' })).toEqual({ state: IDLE, effect: { type: 'dictate', id: 'a', text: 'hello' } })
    expect(step(IDLE, { type: 'transcribed', text: 'late' })).toEqual({ state: IDLE })
  })

  it('shows an error and types nothing on blank text or failure', () => {
    const t: DictationState = { phase: 'transcribing', id: 'a' }
    expect(step(t, { type: 'transcribed', text: '  ' })).toEqual({ state: { phase: 'error', id: 'a', kind: 'nothing' } })
    expect(step(t, { type: 'failed', kind: 'model' })).toEqual({ state: { phase: 'error', id: 'a', kind: 'model' }, effect: undefined })
    expect(step(listening, { type: 'failed', kind: 'mic' })).toEqual({
      state: { phase: 'error', id: 'a', kind: 'mic' }, effect: { type: 'abort' },
    })
    expect(step(IDLE, { type: 'failed', kind: 'failed' })).toEqual({ state: IDLE })
    expect(step(err, { type: 'failed', kind: 'mic' })).toEqual({ state: err })
  })

  it('replaces an error on a new press, but not while busy', () => {
    expect(step(err, down({ id: 'b' }))).toEqual({ state: { phase: 'listening', id: 'b' }, effect: { type: 'start' } })
    expect(step(err, down({ repeat: true })).state).toEqual(err)
  })

  it('clears an error on cancel or clearError only, and error ignores other inputs', () => {
    expect(step(err, { type: 'cancel' })).toEqual({ state: IDLE })
    expect(step(err, { type: 'clearError' })).toEqual({ state: IDLE })
    expect(step(listening, { type: 'clearError' })).toEqual({ state: listening })
    expect(step(IDLE, { type: 'clearError' })).toEqual({ state: IDLE })
    for (const input of [{ type: 'blur' }, { type: 'visibilityHidden' }, { type: 'keyUp', key: 'Shift', code: 'ShiftLeft' }] as DictationInput[]) {
      expect(step(err, input)).toEqual({ state: err })
    }
  })

  it('maps ipc errors and messages', () => {
    expect(errorKind('no-binary')).toBe('binary')
    expect(errorKind('no-binary: whisper-cli')).toBe('binary')
    expect(errorKind('no-model')).toBe('model')
    expect(errorKind('exit 1')).toBe('failed')
    expect(dictationMessage('nothing')).toBe('Nothing heard')
    expect(dictationMessage('model')).toContain('ggml-base.en.bin')
  })

  it('keeps the id locked at press through transcribing too', () => {
    const r = step(step(IDLE, down({ id: 'a' })).state, down({ id: 'b' }))
    expect(step(r.state, { type: 'keyUp', key: ' ', code: 'Space' }).effect).toEqual({ type: 'stop', id: 'a' })
  })

  it('drops silently when the locked session disappears', () => {
    expect(step(listening, { type: 'sessions', ids: ['b'] })).toEqual({ state: IDLE, effect: { type: 'abort' } })
    expect(step({ phase: 'transcribing', id: 'a' }, { type: 'sessions', ids: [] })).toEqual({ state: IDLE, effect: { type: 'abort' } })
    expect(step(err, { type: 'sessions', ids: ['b'] })).toEqual({ state: IDLE })
  })

  it('ignores other sessions closing and idle', () => {
    expect(step(listening, { type: 'sessions', ids: ['a', 'b'] })).toEqual({ state: listening })
    expect(step({ phase: 'transcribing', id: 'a' }, { type: 'sessions', ids: ['a'] }).effect).toBeUndefined()
    expect(step(err, { type: 'sessions', ids: ['a'] })).toEqual({ state: err })
    expect(step(IDLE, { type: 'sessions', ids: [] })).toEqual({ state: IDLE })
  })

  it('an overlay cancels listening only', () => {
    expect(step(listening, { type: 'overlayOpened' })).toEqual({ state: IDLE, effect: { type: 'abort' } })
    const transcribing: DictationState = { phase: 'transcribing', id: 'a' }
    expect(step(transcribing, { type: 'overlayOpened' })).toEqual({ state: transcribing })
    expect(step(err, { type: 'overlayOpened' })).toEqual({ state: err })
    expect(step(IDLE, { type: 'overlayOpened' })).toEqual({ state: IDLE })
  })
})
