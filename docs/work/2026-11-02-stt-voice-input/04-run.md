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

## Open questions
