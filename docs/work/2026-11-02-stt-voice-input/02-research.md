---
feature: 2026-11-02-stt-voice-input
phase: research
status: approved
version: 1
created: 2026-11-02
updated: 2026-11-02
approved_at: 2026-11-02
based_on: []
forced: []
repo_heads:
  - ed1ea362b9fc9f5b07ad0db24cc04d087b115291
---

# Research: speech-to-text input for agent sessions

Facts only. Grove is an Electron app (electron 44, electron-vite, React 19, xterm 6, node-pty). Sessions are tmux sessions on a dedicated server (ADR 0003).

## Voice and audio today

- Nothing in the repo touches voice, audio capture or speech. No getUserMedia, MediaRecorder, SpeechRecognition, microphone, permission handlers, entitlements, Info.plist usage string, or ASR/audio dependencies.
- The only audio is `src/main/sound.ts`: macOS system sounds through `/usr/bin/afplay` when a session starts waiting, gated by `config.json` `sounds`. Output only.

## How text reaches a session today

- **Typing:** the session pane is `src/renderer/src/components/TerminalView.tsx`, an xterm. Keystrokes and paste both arrive via `term.onData` (line 68) and go out as `pty:input` `{attachId, data}` to node-pty running `tmux attach`. `attachId` is private to the component; there is no imperative handle. Mounted from `App.tsx:231` and `SessionGrid.tsx:147`. Any overlay (`overlayOpen`, App.tsx ~277) sets `active=false` and takes keyboard focus from the terminal.
- **No composer:** there is no per-session input box. Grove's own text inputs are `ScratchpadEditor` (CodeMirror, ⌘N), `CommentEditor`, `NewSessionDialog`, `LaunchPalette`, `CommandPalette`.
- **Send path (ADR 0023):** `core.commands.sendToSession({id, text, submit=true})` in `src/core/send.ts:40`.
  - Resumes a `gone` agent session first (agent kinds with an `agentSessionId`; terminals error).
  - Waits for the pane to be stable (`waitStable`, send.ts:17-35: 1s stable, 1s settle, 20s timeout, `not-ready` on timeout).
  - Calls `backend.paste` (`src/core/backend/tmux.ts:98-109`): `set-buffer`, `paste-buffer -p` (bracketed paste), 150ms, then `send-keys Enter` if `submit`. Serialised through a promise.
  - Identical for claude, copilot, opencode and terminal; no per-agent branching. ADR 0023 verified (2026-10-07) that Claude Code and OpenCode treat multi-line bracketed paste as one block. No Copilot-specific verification exists in the repo.
  - Does not check busy/idle: a working session gets the paste at once. A session waiting on a permission or question prompt receives the paste and Enter into that prompt; nothing guards it. Pasted text merges with anything the human half-typed in the agent's composer.
- **Callers:** CLI `grove send <ref> <text|-> [--no-enter] [--wait]` (`src/cli/args.ts`, protocol `src/shared/cli.ts`, server `src/main/cliServer.ts:108-121`), review send (`review:send`, `review:start-and-send`, `core.ts:1175`), initial prompt on session create (`core.ts:951`).
- **Renderer IPC:** no generic "send text to session" channel. `InvokeMap` is `src/shared/ipc.ts:10-41`; handlers registered in `src/main/ipc.ts` through `handle(ch, fn, returnsResult)`; `core.commands.*` map 1:1. Preload (`src/preload/index.ts`) exposes a generic `invoke/send/on`, so a new channel needs only the type and a handler.
- **Session identity:** `Session` (`src/shared/types.ts:11-42`) with `id`, `tmuxName`, `kind` (`opencode|claude|copilot|terminal`), `agentSessionId`, `lastStatus`, live `status` (`working|waiting|idle`), `waitingFor`. The focused session is `UiState.focusedSessionId`. CLI refs resolve in `src/core/cliOps.ts:13`.
- **Status** comes from per-agent sources, not the pty (ADR 0019): Claude hook spool, Copilot plugin hook spool (ADR 0044), OpenCode HTTP/SSE client. Folded in `src/core/status.ts:65`.

## UI shell, keybindings, settings

- Shortcuts are Electron menu accelerators in `src/main/menu.ts`; each click pushes `menu:action` to `App.tsx` `runAction` (~80-130). A new shortcut needs a `MenuAction` variant, a menu item and a `runAction` branch. Taken: ⌘T ⇧⌘T ⌘J ⌘N ⌘W ⌘1-9 Ctrl+Tab ⌘. ⇧⌘J ⌘B ⇧⌘B ⇧⌘A ⌥⌘B ⌘G ⇧⌘G ⌘K. No `globalShortcut` usage.
- No Preferences or Settings UI exists.
- Settings storage: `UiState` in `<userData>/state.json` (`schemaVersion: 10`, `ui:set` invoke, `state:ui` push), optional fields; and `~/.config/grove/config.json` (`projects`, `workflow?`, `sounds?`), read once at start (core.ts:1227-1229), hand-edited, and `saveConfig` (core.ts:242) rewrites only listed keys, so a new key must be added there.
- Pane chrome: `ContentHeader`, `SessionMeta`, `SessionGrid`, `GridControls`. UI primitives in `components/ui/`. CSS modules with tokens (ADR 0012); `noInlineStyles.test.ts` bans inline styles.

## Platform, security, packaging

- `BrowserWindow` (`src/main/index.ts:144-154`) uses `{ preload, contextIsolation: true }`; no permission request or check handlers. Electron's default with no handler allows `getUserMedia`; macOS TCC still needs a usage string on the host app.
- Renderer CSP (`src/renderer/index.html`): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: grove-artifact:; frame-src grove-artifact:`. No `connect-src`, `media-src`, `worker-src` or `wasm-unsafe-eval`; a cloud fetch/websocket, worker, blob URL or WASM model needs CSP changes.
- No electron-builder dependency or config beyond `package.json` `build.asarUnpack`; no entitlements, no Info.plist, no packaging script. The app runs by `npm run dev` or `npm run build && npm start`. Packaged mic access would need `NSMicrophoneUsageDescription` and `com.apple.security.device.audio-input`. Whether stock Electron.app carries the usage string in dev was not verified.
- Network: only OpenCode local HTTP/SSE (`src/core/opencode/client.ts`). No cloud HTTP client, API keys, `safeStorage` or keychain use. Copilot sign-in is in the system keychain.
- External binaries: `execFile` pattern (tmux, git, gh, `$SHELL -ilc` for PATH, afplay) with the login-shell PATH (`src/core/env.ts`).

## Commands and tests

- `npm test` (vitest run), `npm run typecheck` (node then web tsconfig), `npm run build` (electron-vite build), `npm run dev`. README Development section lines 111-117; tmux required.
- Vitest runs in `environment: "node"`, includes `src/**/*.test.ts` only (no jsdom, no tsx). Renderer tests are pure-function or render-to-string. Core tests use fakes and injectable clocks (e.g. `send.test.ts`).
- Relevant ADRs: 0003, 0009, 0012, 0019, 0023, 0027/0028, 0044. Glossary: `CONTEXT.md` "Send path".

## Not covered by tests or docs

- Paste behaviour into Copilot's TUI specifically; paste while an agent is `working`.

## Open questions
