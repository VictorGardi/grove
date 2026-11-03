import { useEffect, useRef, useState } from 'react'
import { start, type Recorder } from './capture'
import { judgeAudio, MAX_RECORDING_MS } from './audio'
import { setDictationHold, swallowStep } from './swallow'
import { errorKind, IDLE, isChord, step, type DictationEffect, type DictationInput, type DictationState } from './machine'

const TIMEOUT_MS = 30_000
const ERROR_MS = 6000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(resolve, reject).finally(() => clearTimeout(t))
  })
}

// Hold Ctrl+Shift+Space to dictate into the focused session. `getTargetId` is read at key press only.
// An open overlay owns the keyboard: it ignores the chord and cancels a recording in progress.
// A locked session that disappears drops the run silently.
export function useDictation(o: { getTargetId: () => string | null; overlayOpen: boolean; sessionIds: string[] }): DictationState {
  const [view, setView] = useState<DictationState>(IDLE)
  const target = useRef(o.getTargetId)
  target.current = o.getTargetId
  const overlay = useRef(o.overlayOpen)
  overlay.current = o.overlayOpen
  const sendRef = useRef<(input: DictationInput) => void>(() => {})

  useEffect(() => {
    let state: DictationState = IDLE
    let recorder: Promise<Recorder> | null = null
    // bumped on every start and abort, so a late result from a cancelled run is dropped
    let run = 0
    let released0 = 0
    let held = false // a dictation hold: chord pressed, Space not yet released
    let capTimer: ReturnType<typeof setTimeout> | undefined
    const setHeld = (v: boolean) => { held = v; setDictationHold(v) }

    const abort = () => {
      clearTimeout(capTimer)
      run++
      void recorder?.then((r) => r.cancel(), () => {})
      recorder = null
    }

    const perform = (effect: DictationEffect) => {
      if (effect.type === 'abort') abort()
      else if (effect.type === 'start') {
        const mine = ++run
        const rec = start()
        recorder = rec
        // permission denied or no device: back to idle, nothing typed
        rec.catch(() => { if (mine === run) send({ type: 'failed', kind: 'mic' }) })
        // a run superseded or aborted while the permission prompt was open must not leave the mic open
        void rec.then((r) => {
          if (mine !== run) void r.cancel()
          else capTimer = setTimeout(() => { if (mine === run) send({ type: 'capReached' }) }, MAX_RECORDING_MS)
        }, () => {})
      } else if (effect.type === 'stop') {
        clearTimeout(capTimer)
        const mine = run
        const rec = recorder!
        const released = performance.now()
        recorder = null
        void (async () => {
          try {
            // the timeout covers the transcription only, never a pending permission prompt
            let pcm: ArrayBuffer
            try { pcm = await (await rec).stop() } catch { return } // start() rejection already reported
            const res = judgeAudio(pcm) !== 'ok'
              ? ('nothing' as const)
              : await withTimeout(window.api.invoke('dictation:transcribe', { pcm }), TIMEOUT_MS)
            if (mine !== run) return
            if (res === 'nothing') return send({ type: 'failed', kind: 'nothing' })
            if (!res.ok) return send({ type: 'failed', kind: errorKind(res.error) })
            released0 = released // read by the dictate effect that send() runs
            send({ type: 'transcribed', text: res.data.text })
          } catch {
            if (mine === run) send({ type: 'failed', kind: 'failed' })
          } finally {
            // however the run ended, the recorder must be released (cancel after stop is a no-op)
            void rec.then((r) => r.cancel(), () => {})
          }
        })()
      } else {
        const { id, text } = effect
        // `gone` / not-found and any other error: nothing to show, nothing was typed
        void window.api.invoke('dictation:dictate', { id, text }).then(
          () => console.log(`[dictation] release→words ${Math.round(performance.now() - released0)}ms`),
          () => {},
        )
      }
    }
    let errorTimer: ReturnType<typeof setTimeout> | undefined
    const send = (input: DictationInput) => {
      // a lost key-up must not leave Space swallowed
      if (input.type === 'blur' || input.type === 'visibilityHidden' || input.type === 'cancel' || input.type === 'overlayOpened') setHeld(false)
      const r = step(state, input)
      const changed = r.state !== state // an ignored input (typing key-ups) must not re-arm the error timer
      state = r.state
      setView(r.state)
      if (changed) {
        clearTimeout(errorTimer)
        if (r.state.phase === 'error') errorTimer = setTimeout(() => send({ type: 'clearError' }), ERROR_MS)
      }
      if (r.effect) perform(r.effect)
    }

    sendRef.current = send

    // swallow the hold's keys in the capture phase so neither xterm nor the pty sees them
    const swallow = (e: KeyboardEvent) => {
      const r = swallowStep(held, { type: e.type as 'keydown' | 'keypress' | 'keyup', key: e.key, code: e.code, chord: isChord({ ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, code: e.code }) })
      if (r.held !== held) setHeld(r.held)
      if (r.swallow) { e.preventDefault(); e.stopPropagation() }
    }
    const onDown = (e: KeyboardEvent) => {
      if (overlay.current) return
      swallow(e)
      if (!isChord({ ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, code: e.code })) return
      send({ type: 'keyDown', ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, code: e.code, repeat: e.repeat, id: target.current() })
    }
    const onUp = (e: KeyboardEvent) => {
      swallow(e)
      send({ type: 'keyUp', key: e.key, code: e.code })
    }
    const onBlur = () => send({ type: 'blur' })
    const onVisibility = () => { if (document.hidden) send({ type: 'visibilityHidden' }) }

    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keypress', swallow, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keypress', swallow, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(errorTimer)
      setHeld(false)
      abort()
    }
  }, [])

  useEffect(() => { if (o.overlayOpen) sendRef.current({ type: 'overlayOpened' }) }, [o.overlayOpen])
  const idsKey = o.sessionIds.join('\n')
  useEffect(() => { sendRef.current({ type: 'sessions', ids: idsKey === '' ? [] : idsKey.split('\n') }) }, [idsKey])

  return view
}
