# 0046. Dictation runs locally on whisper.cpp

Date: 2026-11-02

## Status

Accepted

## Context

Grove users want to speak a prompt into a session instead of typing it. The
requirement is fully local, English-only recognition that a bank security review
can accept: no audio and no text leaves the machine. Grove had no audio, model or
speech code, and already spawns external binaries with `execFile` (tmux, git, gh).

## Decision

- **Engine:** `whisper-cli` from `ggml-org/whisper.cpp` (MIT), run with `execFile`,
  with the English `ggml-base.en.bin` model. The unrelated `vatsalaggarwal/whisper-cli`
  calls OpenAI's cloud and is excluded.
- **Prerequisites are installed by the human (plan D2 B):** the binary is found on
  the login-shell PATH (`brew install whisper-cpp` or a local build). The model is
  fetched by `scripts/stt-fetch-model.mjs`, run by the human outside the app, which
  verifies a pinned sha256 and writes `<userData>/stt/ggml-base.en.bin`. The app
  itself contains no network code for dictation.
- **Capture in the renderer (D3 A):** `getUserMedia` plus an AudioWorklet produce
  16 kHz mono samples, sent to main over IPC, written to a short-lived WAV under
  `<userData>/stt/tmp` and deleted after use. A media-only permission handler
  allows Grove's own window.
- **Shortcut as a window key listener (D4 C):** Ctrl+Shift+Space, hold-to-talk,
  listened to in the capture phase, only while the window is focused. Menu
  accelerators cannot report key release, so the menu item shows the shortcut and
  setup state but does not own it.
- **Delivery through a `dictate` core command (D5 B):** `dictate({id, text})` pastes
  with `submit: false` at once, with no stability wait and no resume; a gone session
  is an error the renderer ignores. The target session is locked at key press.
- **No runtime network:** `src/core/stt/noNetwork.test.ts` is a tripwire, not proof. It fails if a dictation
  module imports `http`, `https`, `http2`, `net`, `dgram`, `tls` or `dns`, or uses `fetch`, `XMLHttpRequest`,
  `WebSocket`, `EventSource` or `sendBeacon`, or if the renderer CSP gains `connect-src`. The evidence is the
  Wi-Fi-off and `lsof -i` checks in the run log.

## Consequences

- First use needs a one-time manual setup. In return the "no outbound traffic"
  claim is simple, the model is a file a bank can scan, and nothing breaks behind
  a proxy.
- The Homebrew binary is a supply-chain item the user's organisation may need to
  approve. A locally built binary on the PATH works the same.
- Packaged builds will need `NSMicrophoneUsageDescription` in `Info.plist` and, for a
  hardened-runtime signed build, the `com.apple.security.device.audio-input` entitlement;
  without them macOS silently denies the microphone. No signing or entitlements config exists, so this
  is documented, not built. In dev mode the microphone prompt is attributed to the host app or terminal.
- Dictation works only while the Grove window is focused, and a terminal program
  that binds Ctrl+Shift+Space never sees it.
- `base.en` may need light edits on technical words; a larger English model is a
  file swap, not a design change. Near-silence can make whisper invent text, so an
  energy gate runs before it is called.
- Rejected alternatives:
  - Model download inside the app: runtime network code, fails behind bank proxies.
  - Bundling binary and model: about 150 MB and no packaging pipeline to carry it.
  - Apple on-device recognition via a Swift helper: needs a second toolchain and
    permission, and "on-device" is not provable by a test.
  - Whisper as WASM or ONNX in the renderer: CSP changes, heavy, slower.
  - Recording in main with `sox` or `ffmpeg`: another prerequisite and the prompt
    lands on the terminal, not Grove.
  - Ctrl+Option+Space or Option alone as the key: clashes with the macOS input
    source shortcut or with typing characters on Swedish layouts.
  - `sendToSession` for delivery: waits for a stable pane, so it fails on a busy
    agent, and can silently resume a gone session.
