# On-device STT for Grove (Tauri 2, macOS): engine research

Researched 2026-11-21. Tags: [V] verified from a fetched primary source, [S] from a search snippet only, [U] unverified / from general knowledge.

## Summary table

| | Whisper (whisper.cpp / whisper-rs) | SFSpeechRecognizer (on-device) | SpeechAnalyzer + SpeechTranscriber | Parakeet (FluidAudio) |
|---|---|---|---|---|
| Min macOS | any Tauri 2 target (10.13+) [U] | 10.15 for on-device flag [S] | **26.0** [V] | 14+ [S] |
| Intel | yes (CPU, no Metal speedup guarantee) [U] | yes [U] | Apple says check `isAvailable` per device [V]; Intel support unverified | Apple Silicon recommended [S] |
| Model delivery | you ship or download (GGML file) | OS (dictation assets) | OS downloads per locale via AssetInventory [V] | you ship or download (~461 MB CoreML) [S] |
| Live partial words | not natively; chunk and re-decode (hack) | yes, `shouldReportPartialResults` [U] | yes, `.volatileResults` [V via docs summary, example from general knowledge] | EOU 120m model is the streaming one [S] |
| Technical vocab | good, prompt biasing via `initial_prompt` | weak, `contextualStrings` only [U] | unknown, no custom vocab verified | good English WER, no biasing verified |
| Integration effort | medium (Rust crate, model mgmt) | medium-high (Swift bridge) | medium-high (Swift bridge, macOS 26 only) | high (Swift only, bridge) |

## A. whisper.cpp / whisper-rs

- License: whisper.cpp MIT [V github.com/ggml-org/whisper.cpp]. whisper-rs Unlicense (public domain) [V codeberg.org/tazz4843/whisper-rs]. OpenAI Whisper weights are MIT [U, from memory].
- whisper-rs feature flags include `metal` (enables GPU at runtime); `coreml` flag was not on the README page fetched [V]. Last commit seen 2026-03-12, no tags [V]. macOS/M1 build needs extra steps in BUILDING.md (not read).
- Metal: whole inference on GPU. Core ML: encoder on Neural Engine, "more than 3x" vs CPU-only, but needs generated .mlmodelc and `-DWHISPER_COREML=1`, with a slow first-run compile [V github.com/ggml-org/whisper.cpp]. Core ML adds a second artifact to ship per model.
- Model files (ggerganov/whisper.cpp on Hugging Face) [V https://huggingface.co/ggerganov/whisper.cpp/tree/main]:
  - tiny 77.7 MB (q5_1 32 MB), base 148 MB (q5_1 59.7 MB, q8_0 81.8 MB)
  - small 488 MB (q5_1 190 MB, q8_0 264 MB)
  - medium 1.53 GB (q5_0 539 MB)
  - large-v3 3.1 GB (q5_0 1.08 GB); large-v3-turbo 1.62 GB (q5_0 574 MB, q8_0 874 MB)
  - `.en` variants exist for tiny/base/small/medium (English only, a bit better at English for small sizes [U]).
  - RAM at runtime per README: tiny ~273 MB, base ~388 MB, small ~852 MB, medium ~2.1 GB, large ~3.9 GB [V].
- Speed [V https://github.com/ggml-org/whisper.cpp/issues/89]: only one Metal+CoreML data point, M1 Ultra encoder time: tiny 19 ms, base 34 ms, small 115 ms, medium 347 ms, large-v3-turbo Q8_0 618 ms (units look like ms, not labelled). M1 Pro CPU/NEON+BLAS (no Metal): small 685 ms, medium 1.9 s, large 3.35 s encode. The encoder runs on a fixed 30 s window, so a 3 s clip costs about the same encoder time as 30 s; the decoder then adds time per token. No M2/M3/M4 or Intel numbers found. For a 10 s clip on a base M-series chip, small or turbo-q5 likely finishes in about 1-3 s [U, estimate].
- Accuracy/languages: ~99 languages for multilingual models; large-v3-turbo is the usual quality/speed pick; small.en or turbo-q5_0 is the likely sweet spot for dev vocabulary [U]. Whisper accepts an `initial_prompt` that biases spelling toward words like "git, TypeScript, rebase" (whisper.cpp exposes `initial_prompt`) [U, not re-verified].
- Delivery: bundling large-v3-turbo-q5_0 adds ~574 MB to the .app/.dmg; small.en-q5_1 adds ~190 MB; base-q5_1 ~60 MB. First-use download keeps the installer small and is still "offline" afterwards, but the first run needs network and a progress UI, plus a place to cache (app data dir). A hybrid is common: bundle a tiny/base model, offer larger as an optional download. Tauri `resources` can bundle files.
- Partial words later: whisper is not streaming. whisper.cpp ships a `stream` example that re-decodes sliding windows with VAD [V mention in discussion #166]; quality is rougher and CPU/GPU is re-spent. Practical path: keep hold-to-talk final-only, and if live text is wanted, periodically decode the growing buffer every ~1-2 s and replace. No rewrite needed if the capture layer yields PCM chunks and the engine interface is "audio in, text out" with an optional partial callback.
- Effort: low-medium for Rust integration (whisper-rs + cpal/resample to 16 kHz mono f32), medium for model download manager. Build needs cmake and Xcode CLT.

## B. macOS built-in

### B1. SFSpeechRecognizer
- `requiresOnDeviceRecognition` only honoured if `supportsOnDeviceRecognition` is true for that recognizer; available since 10.15 [S: Apple docs via search, https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition.md].
- On-device needs the language's dictation data downloaded; error 1101 often means incomplete offline dictation setup [S, https://developer.apple.com/forums/thread/731230]. Forum report of previous segments being dropped on macOS 14 with on-device [S, https://developer.apple.com/forums/thread/731761].
- Permissions: both `NSSpeechRecognitionUsageDescription` and `NSMicrophoneUsageDescription`; app crashes if a key is missing; request via `SFSpeechRecognizer.requestAuthorization` [V https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition, page text came back reworded by the fetcher, treat as summary]. Sandboxed apps also need `com.apple.security.device.audio-input`.
- Partial results: yes, via `shouldReportPartialResults` [U]. Accuracy generally below Whisper and weak on code words [U]. Apple has historically limited recognition duration per request (about 1 minute for server mode) [U].
- Needs a Swift/ObjC bridge from Rust (objc2 or swift-rs).

### B2. SpeechAnalyzer / SpeechTranscriber
- Availability macOS 26.0+ (also iOS 26 etc.) [V https://developer.apple.com/documentation/speech/speechtranscriber.md]. Check `SpeechTranscriber.isAvailable` and `supportedLocales`; if unsupported, Apple suggests `DictationTranscriber` [V same page].
- Locale model assets are installed by the OS, not the app: `AssetInventory.assetInstallationRequest(supporting:)` then `downloadAndInstall()`; `installedLocales` vs `supportedLocales` (downloadable) [V docs page + S https://developer.apple.com/fr/videos/play/wwdc2025/277/]. So first use per language needs network; after that it is offline. Reserved-locale cap exists [S AssetInventory reservedLocales page].
- Forum reports: supportedLocales can list a language that then fails to download (Arabic) [S forum 797835]; empty on Simulator [S 802969]; one report of 14+ s latency on a beta [S 795924]; some older iPhones unsupported [S 806765]. I did not find an authoritative locale list, Intel-Mac support statement, or accuracy benchmark vs Whisper. Mark all unverified.
- Partial results: yes, `.volatileResults` reporting option, results with `isFinal == false` are volatile [docs page confirms ReportingOption exists; semantics from fetcher general knowledge, [U]].
- Permissions: microphone plus speech-recognition usage strings as above [V]; whether SpeechTranscriber needs the speech prompt when you feed it your own audio buffers (not mic via Speech) is unverified.
- Rule: macOS 26 only, so a user on 15 gets nothing; this would have to be an optional engine behind the same interface. Swift-only API; needs a Swift static lib or helper binary.

## C. Others (briefly)
- Parakeet TDT 0.6B v3 via FluidAudio (Swift, CoreML): 25 European languages, macOS 14+/iOS 17+, ~461 MB CoreML subset, streaming only via the separate Parakeet EOU 120m model [S https://huggingface.co/FluidInference/parakeet-tdt-0.6b-v3-coreml, https://github.com/FluidInference/FluidAudio]. Licensing is contradictory across pages: Apache-2.0 for FluidAudio, model weights shown as CC-BY-4.0 (attribution) [S]. Relevant if Whisper latency/accuracy is not enough, but Swift-only and Apple-Silicon-leaning, so it is a poor fit for Intel.
- Moonshine, Vosk: searched, no primary-source results retrieved; not verified. Not recommended to evaluate unless Whisper proves too slow.

## Mic capture and permissions in Tauri 2

Option 1: getUserMedia in WKWebView
- Works only if the host app has `NSMicrophoneUsageDescription`; with it missing, `navigator.mediaDevices` is absent or throws NotAllowedError [V https://github.com/tauri-apps/tauri/issues/2338].
- wry issue 1195 (open, opened 2024-03-20): on macOS 14, default behaviour shows the permission prompt twice (app level and webview level); overriding the WKUIDelegate media-capture handler fixes getUserMedia but breaks getDisplayMedia (not relevant for mic) [V https://github.com/tauri-apps/wry/issues/1195]. Apple forum reports of WKWebView prompts not appearing without a WKUIDelegate [S https://developer.apple.com/forums/thread/734363].
- Audio comes as MediaStream in JS, so needs AudioWorklet/MediaRecorder, resample to 16 kHz, then IPC PCM to Rust (or run WASM STT in JS). More moving parts; WKWebView secure-context rules for `tauri://` / localhost origin not verified.

Option 2: native capture in Rust (cpal, which uses CoreAudio; or AVAudioEngine via objc2) [U on cpal internals]
- Permission is app-level TCC; first capture attempt triggers the system prompt, using the app's `NSMicrophoneUsageDescription`. No webview delegate quirks, no double prompt. Lets you capture at the device rate, resample in Rust, and feed engines directly. Recommended. Caveat: with cpal the stream may start delivering silence if permission is denied, rather than an error [U]; check authorization status via AVCaptureDevice explicitly.

Info.plist / entitlements
- Tauri merges `src-tauri/Info.plist` into the generated plist; add `NSMicrophoneUsageDescription` (and `NSSpeechRecognitionUsageDescription` if using Apple Speech) [V https://v2.tauri.app/distribute/macos-application-bundle/]. Entitlements go in `src-tauri/Entitlements.plist` referenced by `bundle > macOS > entitlements`; applied at signing [V same page].
- Tauri issue 2338: a 2021 commit injects `src-tauri/Info.plist` into the binary in dev and merges it into the bundle [V https://github.com/tauri-apps/tauri/issues/2338; the thread is v1-era, so re-test on Tauri 2].
- Needed entitlement once the app is signed with hardened runtime: `com.apple.security.device.audio-input`. Sandboxed apps need the same [V for sandbox via Apple page summary]. A Claude Code issue reports a binary lacking this entitlement gets mic silently denied with no prompt [S https://github.com/anthropics/claude-code/issues/33023]. Grove has no signing today; unsigned/ad-hoc without hardened runtime does not require the entitlement [U], but a later Developer ID + notarize step will, so add `Entitlements.plist` now. If whisper models are loaded or JIT used, hardened runtime may also need `allow-jit` / `allow-unsigned-executable-memory` only for webview, which Tauri handles [U].
- tauri dev vs bundled: in `tauri dev` the binary runs from `target/debug` launched by Terminal, so TCC attributes the request to the "responsible process" (Terminal/iTerm/your IDE), and the prompt reads "Terminal wants to access the Microphone" [S https://developer.apple.com/forums/thread/801626, https://www.qt.io/blog/the-curious-case-of-the-responsible-process, https://developer.apple.com/forums/thread/756510]. The grant is stored for the terminal, not dev.grove.app. If Terminal lacks the usage-description key the process may be killed or denied silently [U]. Bundled `.app` launched from Finder gets its own entry named after the app and bundle id dev.grove.app. TCC grants key on bundle id / code signature, and ad-hoc re-signing on every build changes the code requirement so grants may reset between builds [S https://github.com/anthropics/claude-code/issues/41297; partially U]. `tccutil reset Microphone dev.grove.app` clears it [S https://developer.apple.com/documentation/xcode/resetting-access-to-protected-resources-in-macos.md].
- I could not verify any of the dev-mode TCC attribution behaviour on this machine; test with a throwaway build before committing to an approach.

## Recommendation sketch (for the caller)
1. Native cpal capture in Rust to 16 kHz mono f32 behind a small `SpeechEngine` trait (`push_audio`, `partial` callback optional, `finish -> text`).
2. Engine 1: whisper-rs with `metal`, model `small.en-q5_1` (190 MB) or `large-v3-turbo-q5_0` (574 MB) as optional download, `initial_prompt` seeded with dev terms. Final-only first; later add periodic re-decode for live words.
3. Optional later engine: SpeechTranscriber on macOS 26+ for true volatile results, behind the same trait; do not make it the only path.
4. Add `src-tauri/Info.plist` (NSMicrophoneUsageDescription) and `Entitlements.plist` (audio-input) now; expect Terminal-attributed prompts under `tauri dev`.

## Not verified
Intel Metal/CoreML speeds; SpeechTranscriber locale list, Intel support, accuracy; SFSpeech partial-result behaviour and duration limits; custom vocabulary support in SpeechTranscriber; Moonshine/Vosk; whether cpal on current macOS surfaces permission denial as an error; Tauri 2 dev-mode plist embedding (evidence is v1-era).
