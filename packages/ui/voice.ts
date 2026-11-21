// Voice input: hold the push-to-talk key in an agent tab, speak, let go, and the words are added to that agent's input. Grove never
// presses Enter. The hold belongs to the tab it started in: the words go there even if the human has looked elsewhere since, and are
// dropped if that tab is gone. The recording and the speech-to-text are the shell's (the recorder); this is the rules around them.
import { bracketedPaste } from '../protocol/paste.ts'
import type { TabKind } from './window-store.ts'

// A hold shorter than this is a stray tap, not speech.
export const MIN_HOLD_MS = 300
// The longest hold: the recording stops there, as if the key had been let go.
export const MAX_HOLD_MS = 60_000

export const DIDNT_CATCH = "Didn't catch that"

// What the window knows of a tab the hold could belong to.
export interface VoiceTab {
  id: string
  kind: TabKind
  exited: boolean
}

export type StartResult = { ok: true } | { ok: false; reason: 'no-model' | 'mic-denied' | 'busy' | 'failed'; message?: string }
export type StopResult = { ok: true; text: string } | { ok: false; message: string }

export interface Recorder {
  start(): Promise<StartResult>
  // Ends the recording and turns it into text, in the language (a two-letter code, or null to let the speech model tell).
  stop(language: string | null): Promise<StopResult>
  // Ends the recording and throws it away.
  cancel(): Promise<void>
}

// What a tab shows while a hold is under way.
export type VoicePhase = 'listening' | 'transcribing'

export interface VoiceDeps {
  recorder: Recorder
  // The tab the key would talk to now: the active tab.
  target(): VoiceTab | null
  // Whether a tab is still there to receive the words.
  tab(id: string): VoiceTab | null
  write(tabId: string, data: string): Promise<void>
  language(): string | null
  // The tab shows the phase, or nothing when null.
  phase(tabId: string, phase: VoicePhase | null): void
  notice(text: string): void
  // The speech model is not on this Mac: asks the human whether to download it; true means they said yes. The download itself is the
  // window's, and says when it is done.
  offerDownload(): Promise<boolean>
  setTimer(run: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  now(): number
}

export interface Voice {
  // The key went down. Returns whether the voice took it: false in a shell tab or with no tab, so the key goes on to the terminal.
  press(): boolean
  // The key came up, or the window lost focus, or the active tab changed.
  release(): void
  // Whether a hold is under way.
  holding(): boolean
}

// The agent tab a hold may start in, or null.
export function voiceTarget(tab: VoiceTab | null): VoiceTab | null {
  return tab !== null && tab.kind !== 'shell' && !tab.exited ? tab : null
}

// What the speech model said as one line, ready to paste: no line breaks, no padding.
export function pasteable(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

interface Hold {
  tabId: string
  startedAt: number
  // Settles when the recording has begun (or failed to).
  started: Promise<StartResult>
  timer: unknown
}

export function createVoice(deps: VoiceDeps): Voice {
  let hold: Hold | null = null
  // From the key coming up to the words being pasted: a new hold waits for it, since the recorder holds one clip at a time.
  let finishing = false

  async function finish(current: Hold): Promise<void> {
    hold = null
    finishing = true
    deps.clearTimer(current.timer)
    try {
      const started = await current.started
      if (!started.ok) {
        deps.phase(current.tabId, null)
        await report(started)
        return
      }
      if (deps.now() - current.startedAt < MIN_HOLD_MS) {
        await deps.recorder.cancel()
        return
      }
      deps.phase(current.tabId, 'transcribing')
      const done = await deps.recorder.stop(deps.language())
      if (!done.ok) {
        deps.notice(done.message)
        return
      }
      const text = pasteable(done.text)
      if (text === '') {
        deps.notice(DIDNT_CATCH)
        return
      }
      const tab = deps.tab(current.tabId)
      if (tab === null || tab.exited) {
        deps.notice('The tab you spoke to is gone, so the words were dropped')
        return
      }
      await deps.write(current.tabId, bracketedPaste(text))
    } catch (error) {
      deps.notice(error instanceof Error ? error.message : String(error))
    } finally {
      finishing = false
      deps.phase(current.tabId, null)
    }
  }

  async function report(failed: Extract<StartResult, { ok: false }>): Promise<void> {
    if (failed.reason === 'no-model') {
      if (await deps.offerDownload()) return
      deps.notice('Voice needs its speech model, which has not been downloaded')
    } else if (failed.reason === 'mic-denied') {
      deps.notice('Voice needs microphone access. Turn it on in System Settings > Privacy & Security > Microphone')
    } else if (failed.reason === 'busy') {
      // The last words are still being turned into text; this press did nothing.
    } else {
      deps.notice(failed.message ?? 'Voice could not start recording')
    }
  }

  return {
    press() {
      const tab = voiceTarget(deps.target())
      if (tab === null) return false
      // Key repeat while held, or a press while the last words are still on their way: the key is the voice's, and does nothing more.
      if (hold !== null || finishing) return true
      const current: Hold = {
        tabId: tab.id,
        startedAt: deps.now(),
        started: Promise.resolve({ ok: true }),
        timer: null,
      }
      current.started = deps.recorder.start().catch((error): StartResult => ({ ok: false, reason: 'failed', message: String(error) }))
      current.timer = deps.setTimer(() => {
        if (hold === current) void finish(current)
      }, MAX_HOLD_MS)
      hold = current
      deps.phase(tab.id, 'listening')
      return true
    },
    release() {
      if (hold === null) return
      void finish(hold)
    },
    holding: () => hold !== null,
  }
}
