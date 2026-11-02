---
feature: 2026-11-02-stt-voice-input
phase: run
status: draft
version: 1
created: 2026-11-02
updated: 2026-11-02
approved_at:
based_on: [03-plan.md@2]
forced: []
---

# Run: speech-to-text input for agent sessions

Profile: inherit
Branch: feature/2026-11-02-stt-voice-input-inherit
Plan commit: 355ea4cecad25219e48e1582deccea9fa84c8670
Roles:
- cto: claude, inherit
- researcher: claude, inherit
- planner: claude, inherit
- reviewer: claude, inherit
- implementer: claude, inherit

## Slice 1

Session: stt-voice-input-slice-1-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `sendToSession` (`src/core/send.ts`) waits for a stable pane and can resume, so a separate `dictate` command was added next to it in `core.ts`. IPC is a typed `InvokeMap` in `src/shared/ipc.ts` with generic preload, so two new channels needed no preload change. `findBin` and the cached login-shell PATH in `src/main/index.ts` locate `whisper-cli`. `TerminalView` owns xterm's key handler, and `App.tsx` knows the focused session in single and grid view.

Implementer 1 (main and core):
- [x] `src/shared/ipc.ts`: `dictation:transcribe`, `dictation:dictate` (planner)
- [x] `src/core/dictate.ts` + test, wired as `commands.dictate`
- [x] `src/core/stt/whisper.ts` + test (WAV, `execFile` runner, output parsing, 30 s timeout, WAV always deleted)
- [x] `src/main/ipc.ts` handlers, `src/main/index.ts` whisper deps and media-only permission handler

Implementer 2 (renderer):
- [x] `src/renderer/src/dictation/machine.ts` + test (idle, listening, transcribing; auto-repeat, release of any chord key, blur, visibility, cancel)
- [x] `capture.ts` + `pcm-worklet.js` (same-origin worklet, no blob, mic closed on stop and cancel)
- [x] `useDictation.ts` (capture-phase listeners, id locked at press, failure clears badge)
- [x] `DictationBadge`, `TerminalView`, `SessionGrid`, `App.tsx` wiring

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: 0 blocking, 8 non-blocking. Applied: permission handler now keeps Electron's default for non-media permissions (the terminal clipboard copy needs it), `useDictation` line moved off the `overlayOpen` comment block.

Pass, 0 blocking, 0 fix rounds. Non-blocking left: Space auto-repeat after releasing Ctrl or Shift can reach the pty; early speech may be clipped by the per-press AudioContext and worklet load; no maximum listening time; consecutive dictations are pasted with no separating space; the chord starts a recording on an ended session with no badge (slice 3); `?url&no-inline` and the worklet under `file://` in a packaged build are unverified.

### Deviations

- The worklet is plain JS (`pcm-worklet.js`), not TypeScript, because Vite would copy a `.ts` worklet untranspiled. The CSP is unchanged: no `worker-src`, no blob.
- The dev-mode microphone spike was not run (no microphone or human in this unattended session); see below.

### Verification

`npm run typecheck` clean; `npm test` 111 files, 1343 tests pass, including the state-machine tests (auto-repeat ignored, release of any chord key ends, blur, visibility and cancel abort, idle to listening to transcribing to idle), `dictate` (`submit: false`, no stability wait, `gone` and not-found errors) and the whisper runner (argv, trimmed text, WAV deleted). `electron-vite build` to a temp dir succeeded and emitted the worklet as its own asset. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Everything that needs a microphone and a live app: the dev-mode microphone prompt spike (`npm run dev`; if dev mode cannot prompt, stop and decide); install `whisper-cpp` and place `<userData>/stt/ggml-base.en.bin`; hold Ctrl+Shift+Space in a Claude pane and speak (words appear unsent, no control characters, release-to-words time is logged as `[dictation] release→words` over 10 runs against the 4 s target); dictating with half-typed text keeps it; one dictation into a Copilot pane; switching to another app while holding cancels and closes the microphone.

## Slice 2

Session: stt-voice-input-slice-2-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: the machine (`dictation/machine.ts`) knows only idle, listening and transcribing, and its `failed` input clears the badge silently. `transcribe` in `core/stt/whisper.ts` throws plain errors for a missing binary or model, which reach the renderer only as the `error` string of the IPC `Result` (`handle` in `main/ipc.ts`). `parseWhisperOutput` keeps `[BLANK_AUDIO]` style tokens. `start()` in `capture.ts` rejects on a denied or missing microphone and `useDictation` turns that into the silent `failed`. The badge is passed down as `'listening' | 'transcribing'` through `App.tsx`, `SessionGrid.tsx` and `TerminalView.tsx`. `<userData>/stt/tmp` is never cleaned at start.

Implementer 1 (main and core):
- [x] `src/core/stt/whisper.ts`: missing binary or model reject with `no-binary: ...` / `no-model: ...`; `parseWhisperOutput` drops bracketed and parenthesised noise tokens; new `cleanStaleWavs(tmpDir)`
- [x] `src/core/stt/whisper.test.ts`: failure mapping, blank-audio filtering, stale WAV removal
- [x] `src/main/index.ts`: call `cleanStaleWavs` once at startup

Implementer 2 (renderer):
- [x] `src/renderer/src/dictation/audio.ts` + test: `judgeAudio(pcm)` returns `short` (under 300 ms), `silent` (energy gate) or `ok`
- [x] `machine.ts` + test: `error` phase with a kind (`mic`, `nothing`, `binary`, `model`, `failed`), `failed` carries a kind, empty text is `nothing`, a new press leaves the error state, `errorKind(ipcError)`
- [x] `useDictation.ts`: map start rejection to `mic`, judge audio before `dictation:transcribe`, map IPC errors, auto-clear the error after 4 s
- [x] `DictationBadge.tsx` (+ css), `TerminalView.tsx`, `SessionGrid.tsx`, `App.tsx`: show the error message on the locked pane

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: 0 blocking, 7 non-blocking. Applied: the error timer is no longer re-armed by ignored inputs (typing key-ups kept the badge up), and the error badge stays 6 s instead of 4 s.

Pass, 0 blocking, 0 fix rounds. Non-blocking left: every `start()` rejection shows the "Microphone access needed" message, including a missing device; `parseWhisperOutput` strips any bracketed or parenthesised group in dictated text, not only whole-segment noise tokens; the energy gate passes on a single loud 20 ms frame, so a key click can still reach whisper; `cleanStaleWavs` would delete an in-flight WAV of a second app instance; `useDictation` races have no hook-level test.

### Deviations

- Added a fifth error kind, `failed` ("Transcription failed"), for spawn errors, non-zero exits and the 30 s timeout, so no failure is silent. Gone or not-found sessions on `dictate` still show nothing, as planned.
- The short-press and energy gate run in the renderer (`dictation/audio.ts`) on the captured samples, before the IPC call, rather than in the runner.
- The missing-binary message names `brew install whisper-cpp`; the missing-model message names the file and the `stt` folder. Slice 4 points both at the setup script.

### Verification

`npm run typecheck` clean; `npm test` 112 files, 1354 tests pass, covering: a tap under 300 ms, an all-zero and a below-gate recording (no IPC call), blank-audio output (`[BLANK_AUDIO]`, `(music)`) giving an empty transcript and the `nothing` state, a stale temp WAV removed, a missing binary and a missing model rejecting with `no-binary` / `no-model` and mapping to the `binary` / `model` states, and no `dictate` effect on any failure state. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Manually deny the microphone permission in System Settings and confirm the badge message; hold the shortcut with no `whisper-cli` and with no model file and confirm each message; a quick tap and a silent hold show "Nothing heard".

## Open questions
