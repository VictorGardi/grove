---
feature: 2026-11-02-stt-voice-input
phase: plan
status: approved
version: 2
created: 2026-11-02
updated: 2026-11-02
approved_at: 2026-11-02
based_on: [01-outcome.md@1, 02-research.md@1]
forced: []
---

# Plan: speech-to-text input for agent sessions

## Decisions

### D1. Speech recognition engine

**Context.** The brief requires fully local, English-only recognition that a bank security review can accept. Grove has no audio, model or ASR code today, and spawns external binaries with `execFile` already (tmux, git, gh).

**Options.**
- A. whisper.cpp (upstream `github.com/ggml-org/whisper.cpp`, MIT; its `whisper-cli` binary run as a child process, the English `ggml-base.en.bin` model; the size is fixed here because latency and accuracy depend on it, and a larger model is a later swap). Latency target: in each of 10 runs of a one or two sentence utterance on the dev machine, words appear within 4 seconds of release. Not to be confused with unrelated projects that share the name `whisper-cli`, such as `vatsalaggarwal/whisper-cli`, which calls OpenAI's cloud API and is excluded. Pros: open source (MIT) and auditable, widely used, no network code needed, accurate on English and technical words, matches Grove's existing `execFile` pattern. Cons: a binary and a model file must exist on the machine; Apple Silicon build only matters at install; transcription takes a second or two per utterance.
- B. Apple on-device speech recognition through a small Swift helper. Pros: no model download, ships with macOS. Cons: needs a Swift toolchain and a second build step Grove does not have, a separate Speech permission, weaker on technical vocabulary, and "on-device" must be forced and cannot be proven by a test the way a missing network path can.
- C. Whisper through WASM or ONNX inside the renderer. Pros: no external binary. Cons: needs CSP changes (`wasm-unsafe-eval`, workers), heavy in the renderer process, slower, and the model still has to be delivered.

**Pick:** A

**Outcome impact.** The human gets accurate local English dictation with no account. They install one open-source binary once (see D2).

### D2. How the binary and model reach the machine

**Context.** The brief says no network call for audio or text, and the human must be able to defend it at a bank. A model download is not audio, but a bank may block it or want to approve the file. Grove has no download, checksum or setup UI today.

**Options.**
- A. Grove downloads the model on first use, with a progress indicator. Pros: zero manual steps. Cons: runtime network code in the app, fails behind a bank proxy, and the "no outbound traffic" claim gets a footnote.
- B. The human installs the prerequisites. the `whisper-cli` built from `ggml-org/whisper.cpp` is found on the login-shell PATH (for example `brew install whisper-cpp`, or built from a reviewed source tag), and the model file is fetched by a documented script (`scripts/stt-fetch-model.mjs`) that verifies a pinned sha256 of `ggml-base.en.bin` from the whisper.cpp Hugging Face repository and writes to `<userData>/stt/`; it can also be copied in by hand. Grove itself contains no network code for dictation. Pros: the strongest security story, a model file a bank can scan and approve, and the "no network" test is simple. Cons: a one-time manual setup, a clear in-badge message is needed when something is missing, and a Homebrew-installed binary is itself a supply-chain item a bank may need to approve (a locally built `whisper-cli` placed on the PATH works the same).
- C. Bundle both in the app resources. Pros: works on first launch. Cons: about 150 MB added to the repo or build, and there is no packaging pipeline today to carry it.

**Pick:** B

**Outcome impact.** First use needs a one-time setup (install the binary, run one script). In return nothing in Grove ever touches the network for dictation, and the files are inspectable.

### D3. Where audio is captured

**Context.** Something has to read the microphone while the key is held. The renderer already owns the keyboard and the pane UI; there is no permission handler, no worker support in the CSP and no microphone entitlement today.

**Options.**
- A. In the renderer: `getUserMedia` plus an AudioWorklet that produces 16 kHz mono samples, sent to the main process over IPC, written to a short-lived WAV file for `whisper-cli`, and deleted right after. Needs a narrow permission handler (media only, Grove's own window) and a CSP `worker-src 'self'` line. Pros: no extra binary, key events and capture sit in one place, the permission prompt is the standard macOS one. Cons: packaged builds will need a usage string and audio-input entitlement (no packaging exists yet); the first dev-mode prompt is attributed to the host app.
- B. In the main process through an external recorder (`sox`, `ffmpeg`). Pros: no renderer audio code. Cons: another prerequisite, the permission prompt lands on the terminal or host rather than Grove, and the recorder start and stop are not tied to key release as tightly.

**Pick:** A

**Outcome impact.** The human sees the normal macOS microphone prompt for Grove and nothing else to install for capture.

### D4. The hold-to-talk shortcut

**Context.** Hold-to-talk needs the key release. Grove's shortcuts are menu accelerators, which only fire on press, so this one must be a key listener in the window. It must also not collide with agent TUIs, existing accelerators or macOS system shortcuts. The outcome fixes one shortcut with no settings.

**Options.**
- A. Ctrl+Option+Space. Pros: easy chord. Cons: it is the macOS default for "select next input source", so it breaks or misfires for anyone with several input sources, such as a Swedish plus English keyboard.
- B. Hold the Option key alone. Pros: one finger. Cons: Option is how Swedish and other layouts type characters such as `@`, so it needs timing and cancel rules and will flash the badge during normal typing.
- C. Ctrl+Shift+Space, listened to in the window in the capture phase so the terminal does not swallow it. Pros: no system or Grove collision that research found, simple key-down and key-up. The listener ignores auto-repeat key-down events, ends the recording when any key of the chord is released, cancels it on window blur, visibility change or an overlay opening (so the microphone is never left open when a key-up is lost), and calls `preventDefault` and `stopPropagation` in the capture phase so nothing reaches the pty. Cons: only works while the Grove window is focused (acceptable: the target is a focused pane); a terminal program that binds it will not see it.

**Pick:** C

**Outcome impact.** The human holds Ctrl+Shift+Space in Grove to talk. It does not work while another app is in front.

### D5. How the words get into the prompt

**Context.** The text must land in the locked session, unsent, for Claude, Copilot and OpenCode alike. The existing send path (`sendToSession`) waits for the pane to be stable for up to about 20 seconds, which a working agent never is, and can resume a gone session. The terminal view's own `pty:input` only exists for an attached pane and its id is private to the component.

**Options.**
- A. Reuse `sendToSession` with `submit: false`. Pros: no new core code. Cons: dictating into a working agent waits and can fail with `not-ready`; it can also silently resume a gone session.
- B. A new core command `dictate({id, text})` behind a new `dictation:*` IPC: it pastes with `backend.paste(tmuxName, text, false)` at once, without the stability wait and without resuming, and reports an error when the session is gone. Pros: immediate and predictable, keyed by session id so the lock-at-press rule is natural, and the same path for all three agents. Cons: a small amount of new core code and tests.
- C. Write bracketed-paste bytes through `pty:input` of the attached pane. Pros: no core change. Cons: the attach id has to be exposed from `TerminalView`, and it bypasses the serialised paste that tmux already guards.

**Pick:** B

**Outcome impact.** Words appear right after transcription even when the agent is busy, are never submitted, and a pane closed mid-talk simply gets nothing: the renderer swallows the `gone` or not-found error and shows no badge message for it.

## Slices

### Slice 1. Hold the shortcut, speak, words appear unsent in the locked pane

**Outcome.** In a running dev build with the binary and model already in place, holding Ctrl+Shift+Space in a session pane shows "Listening", releasing shows "Transcribing", and the transcribed words appear in that session's prompt without Enter.
**Thin end-to-end:** renderer key listener and capture -> IPC -> main whisper runner -> `dictate` core command -> tmux paste -> pane badge. Deliberately missing: the specific failure messages of slice 2, the setup script, grid-focus edge cases, the menu item, docs and the offline guard test. Slice 1 reads the focused session id at key press (not at release), so the intermediate build cannot misroute the text, and gets the binary and model from a manual `brew install whisper-cpp` (or any `whisper-cli` on the login-shell PATH) and a hand-placed `<userData>/stt/ggml-base.en.bin`. Any failure in slice 1 (spawn error, non-zero exit, 30 second timeout, rejected IPC) clears the badge and types nothing, so the slice-1 build cannot hang with the microphone open.
**Files.** `src/shared/ipc.ts` (channels, types); `src/main/ipc.ts` (handlers); `src/core/dictate.ts` + `dictate.test.ts` (new command, core.ts wiring); `src/core/stt/whisper.ts` + `whisper.test.ts` (WAV write, `execFile` runner, output parsing, fake `execFile` in tests); `src/renderer/src/dictation/` (state machine, capture worklet, hook) with a pure state-machine test; `src/renderer/src/components/TerminalView.tsx` or its parent (badge, key handler pass-through); CSS module for the badge; `src/main/index.ts` (media permission handler); `src/renderer/index.html` (CSP: the worklet is a bundled same-origin file loaded under the existing `script-src 'self'`; add `worker-src 'self'` only if the spike shows it is needed, and never allow blob URLs). The first step is a quick spike: confirm that `npm run dev` gets the macOS microphone prompt at all; if dev mode cannot prompt, the run stops and the human decides.
**Verification.** `npm run typecheck` and `npm test` pass, including: the state machine ignores auto-repeat key-downs, ends on release of any chord key, and cancels on blur, visibility change and an explicit cancel input (slice 3 wires the overlay guard to it); `dictate` pastes with `submit: false` and does not call the stability wait, errors on a gone session; the whisper runner builds the right argv and returns trimmed text from a fake process; the state machine goes idle -> listening -> transcribing -> idle. Then `npm run dev`, hold Ctrl+Shift+Space in a Claude pane, say a sentence: the sentence appears in the prompt and is not submitted, nothing else (no control character) appears in the prompt, and the time from release to words is measured and logged. With text already half-typed in the prompt, dictating keeps it and adds the words. One quick dictation into a Copilot pane confirms its paste behavior early. Switching to another app while holding cancels the recording and closes the microphone.

### Slice 2. Honest failures

**Outcome.** Every failure in the brief shows its short badge message and types nothing: microphone denied or missing ("Microphone access needed" with where to allow it), nothing heard or press too short ("Nothing heard"), and missing binary or model (a message naming the setup step).
**Files.** `src/renderer/src/dictation/` (error states and timers); `src/core/stt/whisper.ts` (detect missing binary or model, blank-audio output, and removal of stale temp WAV files at start); an energy gate on the captured samples before whisper is called, so silence never reaches it; badge component; tests for the state machine and the runner's failure mapping.
**Verification.** `npm test` covers: a tap shorter than the minimum duration, empty or blank-audio output, an all-silent recording (blocked by the energy gate), a stale temp WAV removed at start, a missing binary and a missing model each yield the expected state and no `dictate` call. Manually deny the microphone permission in System Settings and confirm the badge message.

### Slice 3. Locked target in grid view and under overlays

**Outcome.** The target pane is fixed at key press: in grid view only that pane shows the badge and receives the words even if focus moves while talking; a pane closed while talking or transcribing drops the recording without redirecting it; the shortcut does nothing while an overlay (palette, dialogs, scratchpad) has the keyboard.
**Files.** `src/renderer/src/dictation/` (lock session id at press); `src/renderer/src/components/SessionGrid.tsx` and `App.tsx` (badge placement per pane, overlay guard); tests for the lock and overlay rules as pure functions.
**Verification.** `npm test` covers lock-at-press and closed-pane drop as pure functions. Manually in grid view: press in pane A, click pane B while holding, release: the words appear in A and the badge was only on A. Close A mid-talk and also while transcribing: nothing appears anywhere and no error is shown. Opening the command palette mid-hold cancels the recording. Dictate into a Claude pane that is waiting on a permission prompt: the text sits in the prompt and nothing is approved.

### Slice 4. Setup script, menu item and docs

**Outcome.** A new machine can be set up from the README: install the binary, run `node scripts/stt-fetch-model.mjs`, and the app reports itself ready. Dictation appears in the Grove menu as an item that shows the shortcut and whether setup is complete.
**Files.** `scripts/stt-fetch-model.mjs` (a developer-run script outside the app, excluded from the network tripwire; the real sha256 is fetched once during implementation and pinned, writes `<userData>/stt/`, refuses a mismatch); `src/main/menu.ts` (Dictation item showing the shortcut and setup state, checked at launch only); `README.md` (setup and bank notes); `docs/adr/` (new ADR: local whisper.cpp, prerequisites, no runtime network); `CONTEXT.md` (Dictation term).
**Verification.** Running the script against a tampered file exits non-zero and writes nothing; with the real file it writes the model and its sha256 matches the pinned value. `npm run typecheck` and `npm test` pass. The menu item shows "setup needed" before and the shortcut after.

### Slice 5. Offline guarantee and agent parity

**Outcome.** The "no outbound traffic" promise is checked, accuracy and latency are confirmed, and the same dictation works the same way in Claude, Copilot and OpenCode sessions.
**Files.** `src/core/stt/noNetwork.test.ts` (a tripwire, not proof: fails if the dictation modules import `http`, `https`, `net`, `dgram`, `tls` or call `fetch`, and if the CSP gains a `connect-src`); notes on packaged-build microphone entitlements in the ADR; `docs/work/2026-11-02-stt-voice-input/04-run.md` records the parity check.
**Verification.** `npm test` runs the tripwire and it fails when a network import is added to a dictation module. With Wi-Fi off, dictate a sentence and confirm it works the same; during a dictation, `lsof -i` for the Grove, Electron and `whisper-cli` processes shows no new outbound connection. Read five scripted English sentences, including technical words such as `useEffect`, `refactor` and `tmux`: each needs only light edits, and the release-to-words time stays under the 4 second target. For each of Claude, Copilot and OpenCode, run `grove new <agent>` and do one real dictation: the text is in the prompt, unsent.

## Reversible choices made in the slices

Minimum press duration (300 ms), transcription timeout (30 s), whisper flags (English forced, fixed thread count), audio sent over IPC as one buffer at release, the temp WAV in an app-private folder under `<userData>/stt/tmp`, the badge at the top corner of the pane, and treating `[BLANK_AUDIO]` and bracketed or parenthesised noise tokens as "Nothing heard". Each can change without touching a decision above.

## Reviewer round log

- Round 1 (4 blocking, 11 non-blocking). Blocking: latency target missing and model size unfixed → fixed by a 4 s p95 target in D1, a measurement in slices 1 and 5, and the model fixed to `ggml-base.en.bin`; three "How I'll know it works" checks unverified (offline traffic, accuracy, half-typed text) → fixed by slice 1 and slice 5 verification; hold-to-talk failure modes (lost key-up, auto-repeat, partial chord release, key leak into the pty) → fixed by the D4 rules, slice 1 state-machine tests and a manual leak check, plus risks; slice 1 could hang with the microphone open → fixed by a catch-all that clears the badge and a 30 s timeout. Applied non-blocking: how slice 1 finds the binary and model, model provenance and Homebrew risk, silent drop on a gone session, no stability wait, dev-mode microphone spike, real dictation per agent, tripwire wording, deviations, palette-mid-hold check, reversible choices listed.

## Deviations from the brief the human should know

- The brief says the shortcut is "available as a menu item like Grove's other shortcuts". Hold-to-talk needs the key release, which menu accelerators cannot report, so the shortcut is a window key listener and the menu item shows the shortcut and setup state instead of owning the shortcut.
- The shortcut works only while the Grove window is focused (D4), cannot be shown as a working accelerator in the menu, and a terminal tool of the human's own that binds Ctrl+Shift+Space will not see it.
- First use needs a one-time manual setup (D2), where the brief imagined only speaking.

## Risks and what is deliberately not done

- The first dev-mode microphone prompt is attributed to the host app (Electron.app or the terminal) and the stock usage string was not verified; slice 1 starts with a spike for this, and if dev mode cannot prompt, the suggested path is launching from a terminal that already has microphone permission.
- Hold-to-talk loses the key-up when the window loses focus or an overlay opens; D4's cancel rule and slice 1's tests cover it.
- Whisper can invent text on near-silence (for example "Thank you."); the energy gate in slice 2 is the guard, not the output filter alone.
- `base.en` may need more than light edits on technical words; the fallback is swapping to a larger English model (a file change, not a design change).
- The network tripwire is a lint-style guard, not proof; the Wi-Fi-off and `lsof` checks in slice 5 are the evidence.
- Copilot's TUI has no recorded paste verification (research); slice 5 checks it. If its prompt treats a bracketed paste differently, the plan stops and the human decides.
- Dictating into a pane waiting on a permission or question prompt types the text there unsent; this is the accepted behavior from the brief.
- Audio is written to a short-lived WAV in an app-private temp folder and deleted straight after transcription (D3); a crash in between could leave one file. Cleanup of stale files runs at start.
- Packaged builds will need `NSMicrophoneUsageDescription` and the audio-input entitlement; no packaging pipeline exists, so this is documented, not built.
- Out on purpose (brief non-goals): auto-send, voice commands, other languages, cloud transcription, settings screen, microphone picker, configurable shortcut, plain-terminal behavior.

- Round 2 (0 blocking, 11 non-blocking). Applied: press-time id capture in slice 1, explicit cancel input, permission-prompt manual check, early Copilot check, CSP note (no blob URLs), energy gate and silence hallucination risk, 10-run latency check, `base.en` accuracy risk, stale WAV cleanup with a test, menu state checked at launch, fetch script outside the tripwire, microphone fallback path.
- Human feedback: named the upstream whisper.cpp repo in D1 and D2 and excluded the unrelated cloud `whisper-cli`.
- CTO check (0 blocking). Noted, not blocking: no-microphone case has only the denied-permission manual check; the one-time manual setup is disclosed under Deviations.

## Open questions
