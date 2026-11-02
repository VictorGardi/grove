import { useEffect, useRef, useState } from 'react'
import { start, type Recorder } from './capture'
import { IDLE, isChord, isChordKey, step, type DictationEffect, type DictationInput, type DictationState } from './machine'

const TIMEOUT_MS = 30_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(resolve, reject).finally(() => clearTimeout(t))
  })
}

// Hold Ctrl+Shift+Space to dictate into the focused session. `getTargetId` is read at key press only.
export function useDictation(getTargetId: () => string | null): DictationState {
  const [view, setView] = useState<DictationState>(IDLE)
  const target = useRef(getTargetId)
  target.current = getTargetId

  useEffect(() => {
    let state: DictationState = IDLE
    let recorder: Promise<Recorder> | null = null
    // bumped on every start and abort, so a late result from a cancelled run is dropped
    let run = 0
    let released0 = 0

    const abort = () => {
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
        rec.catch(() => { if (mine === run) send({ type: 'failed' }) })
      } else if (effect.type === 'stop') {
        const mine = run
        const rec = recorder!
        const released = performance.now()
        recorder = null
        void (async () => {
          try {
            const res = await withTimeout((async () => {
              const pcm = await (await rec).stop()
              return window.api.invoke('dictation:transcribe', { pcm })
            })(), TIMEOUT_MS)
            if (mine !== run) return
            if (!res.ok) return send({ type: 'failed' })
            released0 = released // read by the dictate effect that send() runs
            send({ type: 'transcribed', text: res.data.text })
          } catch {
            if (mine === run) send({ type: 'failed' })
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
    const send = (input: DictationInput) => {
      const r = step(state, input)
      state = r.state
      setView(r.state)
      if (r.effect) perform(r.effect)
    }

    const onDown = (e: KeyboardEvent) => {
      const input = { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, code: e.code }
      if (!isChord(input)) return
      // the terminal and the pty must never see the chord
      e.preventDefault()
      e.stopPropagation()
      send({ type: 'keyDown', ...input, repeat: e.repeat, id: target.current() })
    }
    const onUp = (e: KeyboardEvent) => {
      if (state.phase === 'listening' && isChordKey(e.key, e.code)) {
        e.preventDefault()
        e.stopPropagation()
      }
      send({ type: 'keyUp', key: e.key, code: e.code })
    }
    const onBlur = () => send({ type: 'blur' })
    const onVisibility = () => { if (document.hidden) send({ type: 'visibilityHidden' }) }

    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      abort()
    }
  }, [])

  return view
}
