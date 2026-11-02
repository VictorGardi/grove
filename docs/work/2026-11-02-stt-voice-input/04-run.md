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

## Slice 3

Session: stt-voice-input-slice-3-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: the target id is already locked at press (`keyDown` carries `id`, the machine keeps it) and the badge shows only on the pane whose id it holds (`App.tsx`, `SessionGrid.tsx`), so lock-at-press needs tests, not new code. Missing: `useDictation` never learns that the session list changed (a pane closed mid-talk or mid-transcription keeps its state; the late result then calls `dictate`, whose gone error is swallowed, but the badge and microphone linger) and never learns that an overlay opened (`App.tsx` computes `overlayOpen`; the chord still starts a recording and is swallowed over a form). `cancel` already aborts and drops late results by bumping `run`.

Implementer 1 (renderer):
- [x] `src/renderer/src/dictation/machine.ts`: inputs `overlayOpened` (listening to idle with `abort`; transcribing and error unchanged) and `sessions {ids}` (a state whose id is not in `ids` goes to idle, with `abort` unless in `error`; no message), exported pure `pressBlocked(overlayOpen)` is not needed: the hook returns before `preventDefault` when an overlay is open
- [x] `src/renderer/src/dictation/machine.test.ts`: lock-at-press kept when focus moves, closed pane while listening, transcribing and error drops with no error state, overlay opened cancels only listening, other panes' closing ignored
- [x] `src/renderer/src/dictation/useDictation.ts`: options `{ getTargetId, overlayOpen, sessionIds }`; a press while an overlay is open is ignored and not intercepted; effects send `overlayOpened` when it turns true and `sessions` when ids change
- [x] `src/renderer/src/App.tsx`: pass `overlayOpen` (moved above the hook) and `sessions.map(id)`

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: 0 blocking, 5 non-blocking, nothing applied.

Pass, 0 blocking, 0 fix rounds. Non-blocking left: the overlay cancel runs in a `useEffect`, so the chord can still be handled for one frame after an overlay opens; after an overlay cancel the key-up of the cancelled hold reaches the overlay or terminal (inert); any `sessions` list lacking the locked id drops the run, which assumes the shown session is always in `sessions` (`content()` not traced by the reviewer); hiding the locked pane in grid view (eye toggle) or navigating away keeps recording and delivers to the right pane but shows no badge; no hook-level test for the overlay gate, the `sessions` effect or the `run` race.

### Deviations

- Lock-at-press and the per-pane badge were already built in slice 1, so this slice only added tests for them. The overlay guard and closed-pane drop are two new machine inputs (`overlayOpened`, `sessions`) fed by `useDictation`, which now takes an options object; the rules are pure in `machine.ts` as planned.
- `SessionGrid.tsx` needed no change.

### Verification

`npm run typecheck` clean; `npm test` 112 files, 1358 tests pass, including: id locked at press kept through a later press with another id, a closed locked pane dropping listening, transcribing and error silently (no error state, no dictate), other panes closing ignored, an overlay cancelling only listening. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Manually in grid view: press in pane A, click pane B while holding, release: words in A, badge only on A. Close A mid-talk and while transcribing: nothing appears, no error. Open the command palette mid-hold: recording cancels, microphone closes. Dictate into a Claude pane waiting on a permission prompt: text sits in the prompt, nothing approved.

## Slice 4

Session: stt-voice-input-slice-4-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `src/main/menu.ts` exports `buildMenu(send, installCli, installSkill)` and is called once in `src/main/index.ts` right after `sttDeps` is built; `whisperBin` resolves asynchronously from the login-shell PATH and the model path is `<userData>/stt/ggml-base.en.bin`. `scripts/` holds only `fix-spawn-helper.mjs` (plain Node ESM). The newest ADR is 0045 (0032 is duplicated). The pinned sha256 was read from the Hugging Face LFS pointer for `ggml-base.en.bin` (`a03779c8…d002`, 147964211 bytes).

Implementer 1 (script, menu):
- [x] `scripts/stt-fetch-model.mjs`: download, pinned sha256, atomic write to `<userData>/stt/`, `--from`, tamper refusal
- [x] script test (tampered file exits non-zero and writes nothing; matching file installs)
- [x] `src/main/menu.ts` + `index.ts`: informational Dictation item (shortcut or setup needed), rebuilt once after the login PATH resolves
- [x] `src/main/menu.test.ts`

Implementer 2 (docs):
- [x] `README.md`: dictation setup, bank notes, shortcut row
- [x] `docs/adr/0046-local-whisper-cpp-dictation.md`
- [x] `CONTEXT.md`: Dictation term

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: 0 blocking, 5 non-blocking; applied the ADR wording (tripwire arrives in slice 5) and the README restart note.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: the hash is computed in a `data` listener beside `pipeline` rather than in a Transform; an interrupted download leaves a `.part` file in the model folder (the target is never corrupted).

### Deviations

The script test lives at `src/core/stt/fetchModelScript.test.ts` because vitest only includes `src/**`. The script reads `STT_MODEL_DIR` and, only with it set, `STT_MODEL_SHA256` as test hooks. The default path is the macOS userData folder `~/Library/Application Support/grove/stt` (productName `grove`); APPDATA and XDG paths were added for other platforms.

### Verification

`npm run typecheck` clean; `npm test` 113 files, 1362 tests pass. The real script run (into a temp dir) wrote a 147964211 byte file whose `shasum -a 256` equals the pinned `a03779c8…d002`; `--from` a random 1000-byte file exited 1 and left no directory or file. Menu tests cover both labels, disabled, no accelerator. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Seeing "setup needed" turn into the shortcut label in the running app's Session menu (menu is only unit-tested).

## Open questions
