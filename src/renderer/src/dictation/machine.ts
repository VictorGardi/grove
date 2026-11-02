// Hold-to-talk state machine (pure). The hook feeds it DOM events and carries out the effects.

export type DictationState =
  | { phase: 'idle' }
  | { phase: 'listening'; id: string }
  | { phase: 'transcribing'; id: string }

export type DictationInput =
  // `id` is the focused session at this instant; it is locked at press, not read again at release
  | { type: 'keyDown'; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; code: string; repeat: boolean; id: string | null }
  | { type: 'keyUp'; key: string; code: string }
  | { type: 'blur' }
  | { type: 'visibilityHidden' }
  | { type: 'cancel' }
  | { type: 'transcribed'; text: string }
  | { type: 'failed' }

export type DictationEffect =
  | { type: 'start' }
  | { type: 'stop'; id: string } // end capture, then transcribe
  | { type: 'abort' } // close the microphone, type nothing
  | { type: 'dictate'; id: string; text: string }

export const IDLE: DictationState = { phase: 'idle' }

// Ctrl+Shift+Space and nothing else held, so Cmd/Option combinations keep their own meaning.
export function isChord(e: { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; code: string }): boolean {
  return e.ctrl && e.shift && !e.alt && !e.meta && e.code === 'Space'
}

// Releasing any one key of the chord ends the recording.
export function isChordKey(key: string, code: string): boolean {
  return key === 'Control' || key === 'Shift' || code === 'Space'
}

export function step(state: DictationState, input: DictationInput): { state: DictationState; effect?: DictationEffect } {
  switch (input.type) {
    case 'keyDown':
      // auto-repeat must not restart or extend anything; a second press mid-transcription is ignored
      if (state.phase !== 'idle' || input.repeat || !isChord(input) || input.id === null) return { state }
      return { state: { phase: 'listening', id: input.id }, effect: { type: 'start' } }
    case 'keyUp':
      if (state.phase !== 'listening' || !isChordKey(input.key, input.code)) return { state }
      return { state: { phase: 'transcribing', id: state.id }, effect: { type: 'stop', id: state.id } }
    case 'blur':
    case 'visibilityHidden':
      // a lost key-up must not leave the microphone open; transcribing has no microphone to close
      return state.phase === 'listening' ? { state: IDLE, effect: { type: 'abort' } } : { state }
    case 'cancel':
      return state.phase === 'idle' ? { state } : { state: IDLE, effect: { type: 'abort' } }
    case 'transcribed':
      if (state.phase !== 'transcribing') return { state }
      return input.text.trim() === '' ? { state: IDLE } : { state: IDLE, effect: { type: 'dictate', id: state.id, text: input.text } }
    case 'failed':
      return state.phase === 'idle' ? { state } : { state: IDLE, effect: state.phase === 'listening' ? { type: 'abort' } : undefined }
  }
}
