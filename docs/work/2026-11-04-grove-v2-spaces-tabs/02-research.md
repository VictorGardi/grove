---
feature: 2026-11-04-grove-v2-spaces-tabs
phase: research
status: approved
version: 2
created: 2026-11-04
updated: 2026-11-04
approved_at: 2026-11-05
based_on: []
forced: []
repo_heads:
  - 440f79531be3b22fa5b68858fbd6a9f101fce0b3
---

# Research: Grove today, Herdr, and stack options

Facts only. Two researchers: one mapped this repo, one read Herdr, agent upstream docs and stack options on the web. Items marked UNVERIFIED could not be confirmed.

## A. Grove today (repo at 440f795)

### Size and health
- About 33k lines under `src/` including 4.3k CSS: core 5,964 (tests 9,508), renderer 7,009 (tests 3,616), main 899, shared 555, cli 308. 119 test files, about 1,305 tests, vitest, node environment only (no component tests). No open-work markers in the source; fragility is recorded as comments.
- `src/core/core.ts` is 1,476 lines: all commands, polling, discovery, diff, classifier and status glue in one `createCore` closure.
- Commands: `npm test`, `npm run typecheck`, `npm run build`, `npm run dev`. Needs `tmux`; optional `git`, `gh`, `claude` (classifier), `whisper-cli`, `jq` (Claude statusLine). Native dep `node-pty` 1.1.0 with a postinstall spawn-helper patch. Electron 44, React 19, zustand 5, xterm 6.

### Data model
- Files: `config.json` (projects, no migrations), `state.json` (schemaVersion 11, migrations v1 to v11, sessions plus ui), `comments.json` (v3), `notes.md`, per-launch spools under `agents/`, `grove.sock`. Writes are atomic; bad files are renamed aside and the app starts empty.
- `Project {id, name, path, worktreeOf?}`: one path per id; a worktree is its own Project; the repo group is derived from git's common dir.
- `Session` persisted fields: core (`id, projectId, kind, label, labelPinned, tmuxName, cwd|null, agentSessionId, startedAt, endedAt, lastStatus, seenAt, lastContext, launchModel`), convenience (`lastFocusedAt, lastLine, sound, promoted`), feature-tied (`feature, linkPinned, action` (dead), `workflowStatus`), relation (`link {id, kind: group|slice}`). Status, branch, PR, progress, context gauge and `statusAt` are live-only and stripped at save.
- Dead keys still preserved in saved files: `zoneOverride, sidebarView, groupBy, board, artifacts, held, handled, attention, escalateAfterSec`. Sandbox was removed in the v9 to v10 migration (deletes sandboxed sessions); `legacySandboxCleanup.ts` (94 lines) and an 18-line unused `backend/herdr.ts` stub remain.
- `UiState`: mutually exclusive focus (session, feature, project, artifact), sidebar settings, viewer and diff prefs, grid `{open, members<=9, spans, tracks}`. All persisted, including focus.
- Features, stages and card state are derived from `workflow.yaml` and feature folders, never persisted. Comments are keyed to a session or a feature.
- The CLI has no project command; `resolveProject` registers a project implicitly from a `cwd` (longest containing registered path, else git top level).

### Session runtime
- Start (`core.ts:934-1025`): resolve project, mint agent session id, build argv, insert a placeholder (never saved), preflight, optional worktree, `tmux new-session`, set colors, lock worktree. Terminal prompts are typed after the pane is stable.
- tmux on a dedicated socket (`-L grove`, own `tmux.conf`: status off, mouse on, 50k history, `remain-on-exit failed`). Agents run through `$SHELL -l -i -c 'export PATH=...; exec <argv>'`. Liveness via `list-sessions` and `#{pane_dead}`; `capture-pane`; send is `paste-buffer -p` then Enter, serialised.
- Display: node-pty runs `tmux attach` per renderer attach; xterm.js with fit and WebGL addons. Multiple concurrent attaches are allowed; attaches die with the renderer.
- Resume only for gone agent sessions, in a new tmux session with the same name. Sending to a gone session resumes it first and waits up to 20s for a stable pane.
- Worktrees live at `~/.grove/worktrees/<repo>/<branch>`; locked while a session is live; merged ones cleaned up on request; dead ones pruned at start.
- Per-agent argv (before the login-shell wrap):
  - claude: `claude --session-id <uuid> --settings <inline hooks+statusLine json> [--model M] [--name L] [--] <prompt>`; resume `claude --resume <id> --settings ...` (id follows the latest SessionStart, to handle `/clear`).
  - opencode: `opencode -s <ses_id> [--prompt P]`; model via `OPENCODE_CONFIG_CONTENT`; tabs off and a theme via `OPENCODE_CLI_CONFIG_CONTENT`.
  - copilot: `copilot --session-id <uuid> --plugin-dir <dir>/<id>.plugin [--model M] [--interactive=<prompt>]`; resume `copilot --resume=<id>`.
  - terminal: login shell, not resumable. Env `GROVE_SESSION_ID`, `GROVE_SOCKET` for all.

### Agent status
- Pipeline: each source emits neutral events (`connected, disconnected, exec-started, exec-ended, pending, child, busy, context, prompt, wrote`); core folds them into per-session trackers; precedence is pending permission, pending question, working (turn or busy subagents), unseen finished turn (waiting/done), idle. The UI shows `gone` (tmux) first.
- Claude: 12 hook events appended as JSONL to a per-launch spool; a tailer uses `fs.watch` plus a 1s poll with byte offsets and tolerates corrupt records. Comments in code admit gaps: a turn woken by a background task has no UserPromptSubmit; an interrupt or Esc-rejected question fires no hook; PermissionRequest fires for questions too; subagent marks can leak on a missed SubagentStop.
- OpenCode: reads `~/.local/state/opencode/service.json`, connects to the shared service over HTTP and SSE (`/api/event`), 45s silence watchdog, reconnect backoff 1s to 10s, snapshot re-sync through several `/api/session/*` endpoints. Pinned to OpenCode 2.0.20 "Experimental API". Questions come from `form.*` events.
- Copilot: per-launch plugin with 8 hooks (`--plugin-dir`, user settings untouched) plus a second source tailing `~/.copilot/session-state/<id>/events.jsonl` at 1s. Attention only from `notification` events (`permissionRequest` is not used because it fires for auto-approved calls). Edit/create write paths "NOT verified against a real run"; subagents "not signalled".
- Re-sync on every reconnect uses a snapshot with queued-event replay and a generation counter; the first re-sync records waiting sessions without notifying. Writes missed while the app was closed are recovered by `catchUp`.
- Seen mark: only the focused pane in a focused window counts as seen; notifications fire on entering a waiting state while off screen; finished children stay quiet.
- Plain terminals: polled at 1s via `pane_current_command`; a command that ran at least 3s and ended while off screen becomes waiting/done.
- A classifier sends the last 40 screen lines of a finished unseen top-level Claude session to `claude -p` (small model) for a `needs-you` or `done` verdict and a 120-character summary. One call at a time, no retry.
- Liveness poll every 5s; branches and PRs (`gh`, cached 60s).

### Core/UI boundary
- Core is a library imported into Electron main (ADR 0004), not a process. Only boundaries: Electron IPC and the tmux server. Renderer is React with zustand, holding mirrored slices.
- IPC: about 30 invoke channels, 3 send, 10 push (`state:projects|sessions|ui|features|opencode|diff|comments`, `pty:data|exit`, `menu:action`). Seven slices are pushed whole on every change, coalesced per `setImmediate`; core persists synchronously on every change.
- CLI (`grove`): unix socket `grove.sock`, one JSON line per connection, protocol 1, runs as Electron-as-node. Commands: `ls, new, send, wait, focus, kill, status, progress, skill, read`; `ref` is id, id prefix (4+) or exact label. `wait` exits 0 idle, 5 gone, 124 timeout.
- On quit: pollers, agent sources, watchers, PTY attaches, the CLI server and notifications stop. tmux and the agents survive; hooks keep appending to spools. Nothing watches while the app is closed; next start reconciles and re-syncs. There is no daemon.

### Grid mode (ADR 0031)
- `ui.grid {open, members<=9, spans?, tracks?}` in `state.json`. Shown when open and the focused session is a member. Auto layout: 1 column for 1 pane, 2 for 2 to 4, 3 for 5 to 9, last pane stretches. Manual spans (`1x1|wide|tall`), track fractions, draggable dividers, header-drag swap.
- One `TerminalView` and one node-pty `tmux attach` per visible running member (up to 9); panes are keyed by session id so reflow does not re-attach. Ended members show a tile with Resume and Remove. Only the focused pane counts as seen; others dim to 0.65. About 600 lines in total with CSS.

### Everything else (non-test lines, approximate)
- Workflow engine (YAML, stages, discovery watchers) about 470; feature and artifact pages about 370; artifact viewer with sandboxed iframe protocol about 680; comments and review tray about 700; session diff about 1,300; command palette about 210; launch palette and dialog about 800; dictation (whisper-cli) about 400; scratchpad about 240; auto-flow support (RunProgress, ChildDrawer, slice links) about 400; shipped skills about 500; sidebar (repo groups, nested worktrees, parent/child, 6 sorts, compact rows, drag reorder, multi-select) about 1,000 plus 670 CSS; classifier 80; PR markers 35.
- Terminology: the code says project and session; there is no "space" or "tab" concept.

## B. Herdr (primary sources, fetched 2026-11-04)

### Projects and maturity
- Three Apache-2.0 repos under `herdrdev`: `herdr-app` (desktop, about 1.9k stars), `herdr-core` (daemon, about 386 stars), `herdr` (older terminal UI, about 48.1k stars). Platforms: macOS Apple silicon (Intel from source), Linux x86_64/arm64 (needs Vulkan), Windows x64.
- Very young and fast: core 0.1.10 (2026-10-23) to 0.1.18 (2026-11-04); app 0.1.4 to 0.1.13 over the same 12 days.

### Data model
- Space = "work on one machine, usually one repo"; contains tabs; tabs split into panes holding terminals or mod panels. Unnamed spaces follow their first terminal's folder. Terminals labelled `herdr.space` and `herdr.tab` appear in the app even when started from the CLI.
- Sidebar agent list shows Working / Blocked / Done / Idle across spaces; workers without a pane open in a peek overlay. Remote machines (SSH) appear in the same sidebar. The guide suggests a space per branch or issue, nested under its repo.
- How a new tab opens in the space's root dir: not documented (UNVERIFIED).

### Core/UI split
- "The window arranges terminals. The core runs them." Closing the window leaves terminals running. Transport: unix socket (named pipe on Windows), JSON-RPC 2.0 one message per line; optional framed mode multiplexes DATA, CREDIT, CLOSE, RESIZE, FOCUS, FACTS, AUTOMATIC_INPUT channels. Schema is OpenRPC (`hc schema`, `rpc.discover`).
- `terminal.attach` sends a paint of the current screen, optional history, latest status and title, then raw output with credit flow control (starts at 256 KiB); the core never encodes keys.
- `events.subscribe` returns a snapshot plus a `seq` that resets on core restart; events: `created, lost, restarted, keep, finished, removed, status, turn, title, labels, size, foreground, doc`. A versioned JSON document store (`doc.get/set`, 1 MiB per value) is part of the API.
- `hc connect` carries the same protocol over stdin/stdout (`ssh box hc connect`); remote machine events arrive in one stream with machine-qualified names. No API auth; core is "not a sandbox or permission broker"; socket dir is mode 0700; state is unencrypted in `~/.local/state/herdr-core/<session>/`.

### PTY ownership and survival
- A separate holder process owns every PTY and is every program's parent; it always reads output, parses nothing, and keeps at most 1 MiB raw tail per terminal in memory. A new core replays tails to rebuild screens; the core saves screens and history to disk.
- If the core crashes the holder restarts it after a 3 s grace with backoff to 60 s; programs keep running. Core updates and `hc server restart` leave programs running. After a reboot or `hc server stop`, kept terminals return as fresh shells; tasks are never rerun. (The older TUI claims it can resume supported agent sessions after a restart; not verified for the new app.)

### Status: OSC 7501 (Program Status Protocol)
- `ESC ] 7501 ; state=<s>:id=..:kind=..:progress=..:app=..:title=<b64>:msg=<b64> ESC \`. States `idle, working, done, blocked, error`, plus `clear` as a command; `kind` is `permission | question | auth` (only with blocked); hierarchical `id` with `/`; empty id is the root; at most 256 child records; a `turn` counter increments when the root leaves working; `stuck` is set when the root newly becomes blocked or error.
- The core stores what a program reports and never infers status from screen or agent brand; programs that report nothing have no status. No per-agent hooks for Claude, OpenCode or Copilot were found in core. Whether the app itself sets 7501 for Claude is UNVERIFIED; secondary sources conflict (screen detection vs `herdr integration install claude` hooks). The nested-tmux caveat from the earlier internal note was not found upstream (UNVERIFIED).

### Stack
- Core: Rust, crates `herdr-core` and `ghostty-vt`, built with Zig 0.16. App: Rust, `gpui-pre` =0.3.8 (patched Zed GPUI snapshot), local `ghostty-sys`, vendored `gpui-kit`, QuickJS via `rquickjs` for mods, no tokio. Several GPUI crates are patched or vendored locally.

### Extensibility ("your agent can change the app")
- Mechanism is a mod system, not a rebuild. `~/.config/herdr-app/AGENTS.md` is regenerated on every start and agents are told to read generated `herdr.d.ts` and `gpui-kit.d.ts` before editing.
- Extension points in `~/.config/herdr-app/`: `layouts/<name>.json` (tree of block/row/column/stack nodes, blocks hold a mod, terminal, active tab or agent), `mods/<name>/main.js` plus optional `mod.json` (JavaScript in QuickJS rendered with gpui-kit), `keys.json`, `settings.json`, `programs.json` (agent launchers), `themes/`, `icons/`, `fonts/`. Also floating blocks, pane-header mods, context menus, overlays and dialogs.
- Shipped layouts and mods are read-only and replaced at start; users clone them (`herdr-app do layout.clone | mod.clone`). Mod API: live data (`spaces()`, `agents()`, `terminals()`, `panes()`), `run`, `exec`, `hc`, `readTextFile`, `writeTextFile`, `watchFolder`, `fetch`, shared state, `openOverlay`, `notify`.
- Saving reloads live (about one second); an invalid file keeps the last good version and writes an `.error` file. Helpers: `herdr-app check <mod>`, `status`, `shot` (PNG), safe-mode key. Mods are trusted, unsandboxed code. Core or app Rust changes need a rebuild. An in-app code editor is not documented; whether gpui-kit has an editor widget is UNVERIFIED.

## C. Agent integration surfaces (upstream docs)

- **Claude Code**: 33 hook events including `SessionStart/End, UserPromptSubmit, Stop, StopFailure, PreToolUse, PermissionRequest, PermissionDenied, PostToolUse(Failure), SubagentStart/Stop, Elicitation*, Notification, CwdChanged`; notification types include `permission_prompt, idle_prompt, elicitation_dialog, agent_needs_input, agent_completed`. Hook types: command, http (POST), mcp_tool, prompt, agent. Every hook gets `session_id, transcript_path, cwd, permission_mode`. No general "permission resolved" event. `--settings <file|json>` overrides per launch; `--session-id`, `--resume`, `--continue`, `--fork-session`, `--name`, `--model`, `--permission-mode`. Statusline script receives JSON (model, cost, context window, rate limits, worktree), debounced 300 ms. Whether AskUserQuestion triggers PermissionRequest is UNVERIFIED.
- **OpenCode**: `opencode serve` (default 127.0.0.1:4096, OpenAPI at `/doc`, optional basic auth); `POST /session`, `POST /session/:id/prompt_async`, `POST /session/:id/abort`, `POST /session/:id/permissions/:permissionID`, `GET /event` SSE; plugin events `permission.asked/replied`, `session.status`, `session.idle`, `session.error`, `tool.execute.*`. Official docs list no `question.*` events; third-party clients treat `question.asked` as pending (UNVERIFIED upstream). CLI `--model/-m`, `--session/-s`, `--continue/-c`, `--fork`, `--agent`, `--port`.
- **GitHub Copilot CLI**: hooks `sessionStart/End, userPromptSubmitted, preToolUse, permissionRequest, postToolUse(Failure), agentStop, subagentStart/Stop, errorOccurred, notification, preCompact`; config from `.github/hooks/*.json`, `~/.copilot/hooks/` (or `$COPILOT_HOME`), settings files and plugins, loaded at CLI start. `copilot --acp --stdio|--port N` ACP server (public preview), settings fixed at launch. `--continue`, `--resume`; `--resume <id>` and `--model` only from community sources (UNVERIFIED upstream); no question-specific signal documented.

## D. Stack facts (registry data fetched 2026-11-04)

- **Electron + Node**: Electron 45.2.2 (2026-11-03) with 42 to 44 maintained. `node-pty` 1.1.0 (2025-12-22), 1.2.0-beta line still publishing (beta.18, 2026-10-23); MIT; used by VS Code; not thread safe; native build; children run with the parent's permissions. `@xterm/xterm` 6.0.0, `addon-webgl` 0.19.0, `addon-serialize` 0.14.0 and `@xterm/headless` 6.0.0 (all 2025-12-22; betas active). `utilityProcess.fork` gives an isolated Node child with MessagePort; whether it outlives app quit is UNVERIFIED; a detached `child_process` daemon is the usual alternative.
- **Tauri + Rust core**: Tauri 2.12.5 (2026-10-21), 3.0 alpha out. `portable-pty` 0.9.0 (2025-02-11, 26M downloads, no release in about 21 months); `alacritty_terminal` 0.26.0 (2026-04-06); `vt100` 0.18.1 (2026-10-19); `tauri-plugin-pty` 0.3.1 (small). macOS webview is WKWebView (updates with the OS); Windows WebView2; Linux WebKitGTK. A user report estimates a WKWebView WebGL context ceiling of about 8 to 16 xterm panes (the reporter's estimate, not a documented limit); suggested fixes are disposing WebGL on hidden tabs or a canvas fallback. Tauri plugins are Cargo crates added at build time; no runtime plugin loading documented; sidecars need per-target binaries and capability entries.
- **Native Rust UI**: `gpui` crate 0.2.2 (2025-10-22, Apache-2.0, README says pre-1.0 with breaking changes); Herdr uses `gpui-pre` 0.3.x snapshots (0.3.11, 2026-11-02). No terminal widget ships with GPUI. egui/eframe 0.37.0 with `egui_term` 0.1.0 (2025-04); iced 0.14.0 with `iced_term` 0.8.0 (2026-03).
- **Terminal emulation libraries**: `ghostty-web` 0.4.0 (2025-12-09, MIT, about 400 KB WASM, xterm.js-compatible API, about 3k stars); `libghostty-vt` MIT, no tagged version, API "still in flux"; Rust bindings `libghostty-vt` 0.2.2 (2026-09-28, needs Zig 0.17, pre-1.0). `wezterm-term` was not found on crates.io.
- **Dropping tmux**: a Rust core must provide a long-lived PTY owner that reads with no client attached, a VT screen model in a separate process for repaint on attach, bounded raw scrollback and replay, per-viewer flow control and a size-owner rule, disk persistence of screens and history, and crash supervision. Herdr splits this into a holder (raw bytes in memory) and a core (screen model and disk). Neither Herdr nor tmux preserves programs across a reboot. For a web UI, `@xterm/headless` plus `addon-serialize` give a Node-side screen model; sufficiency for reattach was not verified.

## E. Prior art

- Superset (Electron, React, tRPC; MIT per repo page, ELv2 per a search snippet): sidebar shows working/done/waiting; how status is produced and any daemon split were not found (hooks installed into agent configs is UNVERIFIED).
- cmux (Swift/AppKit, libghostty, about 28.7k stars, GPL-3.0-or-later, macOS only): reads OSC 9/99/777; `cmux notify` wired into Claude and OpenCode hooks; unix socket API and CLI.
- Secondary sources only: Agent Squad (daemon with SQLite and SSE, Ink TUI), atmd (Rust daemon fed by Claude hooks over a socket, tmux-based), Claude Ops (Node daemon, React UI, hook-driven), Claude Squad (worktrees plus tmux, TUI, AGPL-3.0).
- Extension models: Zed extensions are Rust compiled to `wasm32-wasip2` (sandbox model UNVERIFIED); VS Code runs an extension host in Node or a WebWorker; Obsidian plugins have full access, with Restricted mode blocking all third-party code by default; Neovim remote plugins are out of process over msgpack-rpc, Lua plugins in-process; OpenCode JS/TS plugins run in its process via Bun.

## Spikes

### S0. Tauri versus Electron for the window (2026-11-04)

**Question.** On a Mac, does a Tauri 2 window running our web UI show nine live xterm.js terminals fed by a Node holder stub over a unix socket within these bars: no context loss over 60 seconds of heavy output, 30 frames per second or better, key echo median of 50 ms or less and 95th percentile of 100 ms or less, with the same page in Electron as the baseline? What does it take to build and run it? Time box agreed with the human: about three hours, personal Mac only (macOS 26.4.1, Apple silicon).

**Answer.**
- **Nine panes.** In Tauri 2.12 (the system WebKit view) all nine xterm.js 6.0.0 terminals loaded the WebGL renderer and ran 60 seconds at 300 KB/s per pane (about 157 MB, 2.6 MB/s in total) with no context-lost event in any run. The same page in Electron 44.5 did the same. A 16-pane run (150 KB/s per pane) also loaded all 16 WebGL panes with no context loss in both, so the user-reported 8 to 16 pane ceiling was not reproduced up to 16. Above 16 was not tested.
- **Frame rate.** Electron held 60 frames per second with no frame over 50 ms in every run. Tauri averaged 52.7 to 60 frames per second in seven of its eight nine-pane runs and 37.8 in one. In two of the eight runs (window not brought to the front) rendering stalled for 2,984 ms and 19,505 ms; one other run had a 108 ms frame; the other five had no frame over 50 ms. The stalls did not come back in the last five runs, including four alternating runs with and without an App Nap opt-out (all 60 frames per second, no frame over 50 ms), so App Nap is not the explanation. The cause of the two long stalls was not determined.
- **Echo and data lag.** Key echo through the whole path (page, Rust side, socket, holder, PTY and back, to the end of the xterm write) was Tauri median 1 to 2 ms, 95th percentile 3 to 8 ms, worst 8 to 221 ms; Electron median 0.9 to 1.5 ms, 95th percentile 3.6 to 4.2 ms (51.5 ms in one run where the window was reported hidden and the machine hiccuped), worst 5 to 565 ms. Delivery lag of the load frames, 95th percentile: Tauri 5 to 7 ms, Electron 3 to 5 ms. All within the bars.
- **Throughput.** Tauri's Rust side relayed raw bytes to the page through a Tauri channel without loss: 157.2 MB received in 60 seconds, against 157.3 MB for Electron.
- **Memory.** Sum of resident memory of the app's processes (plus the new WebKit processes for Tauri; shared pages are counted twice; the Node holder, 73 to 100 MB in both, is excluded). Nine panes, median over the run: Tauri 346 to 387 MB, Electron 489 to 585 MB. Pairs: 363 against 582 MB (38 percent lower), 346 against 585 (41 percent lower), 387 against 489 (21 percent lower; the Electron window was reported hidden in that run). Sixteen panes: 476 against 624 MB (24 percent lower).
- **Size.** The Tauri spike app is 10 MiB; the Electron app this repository already has is 288 MB (about 29 times larger).
- **Install and build.** Nothing new was installed on this Mac: Rust 1.95 (from Homebrew, no rustup) and the Xcode command line tools were already there, and the Tauri command line came as an npm dev dependency (`@tauri-apps/cli` 2.12.4), not through `cargo install`. A first release build with an empty crate cache (downloads included) took 60 seconds (302 seconds of CPU), used 179 MB of crate cache and 952 MB of build output; a rebuild after a code change took 10 to 12 seconds. Electron needs no toolchain. Installing Rust through rustup on a fresh Mac and the work Mac were not tested.
- **Other things met.** npm 11 did not run node-pty's install script (an allow-scripts warning); node-pty 1.1.0's prebuilt darwin-arm64 binary loaded, but its `spawn-helper` needed `chmod +x` (the old Grove patches this in its postinstall). The npm cache folder `~/.npm` has root-owned files on this Mac, so a scratch cache was used.
- **Rust side starts the holder.** With no socket present, Tauri's Rust side started the Node holder detached (`setsid`), and the holder was still alive after the app quit in every run. Electron's main process did the same with a detached child process.
- **Live CSS.** A changed CSS file reached the page in 24 to 89 ms in Tauri and 12 to 35 ms in Electron, both with a 100 ms poll on the native side. A file-watching crate was not tried.
- **Notifications.** Both APIs reported success in every run. In the first attempt (a bare Tauri binary and the Electron dev binary) the human saw and heard nothing. In the second attempt Tauri, run from its real `.app` bundle, showed a banner with sound; the Electron dev binary showed nothing. Click-through to a tab was not tested, and why Electron showed nothing was not determined.
- **Not tested.** The work Mac and other macOS versions; WebGL above 16 panes; real agents instead of `cat` and synthetic output; flow control with credits; a window on a hidden Space; the cause of the two long stalls.

**Evidence.** Per-run results, kept in the scratch worktree until it is deleted:

| Run (nine panes, 60 s) | fps avg | worst frame | frames over 50 ms | echo median / p95 / worst (ms) | context lost |
|---|---|---|---|---|---|
| Tauri 1 | 56.9 | 2,984 ms | 2 | 2 / 8 / 13 | 0 |
| Tauri 2 | 37.8 | 19,505 ms | 9 | 2 / 7 / 221 | 0 |
| Tauri, window forced to front | 57.1 | 50 ms | 0 | 1 / 3 / 8 | 0 |
| Tauri, not forced | 52.7 | 108 ms | 3 | 2 / 5 / 13 | 0 |
| Tauri, 4 runs (App Nap on and off) | 60 | 34 to 49 ms | 0 | 1 to 2 / 5 to 7 / 8 to 13 | 0 |
| Electron 1 | 60 | 18.8 ms | 0 | 1 / 4.2 / 7.2 | 0 |
| Electron 2 | 60 | 34.4 ms | 0 | 0.9 / 3.8 / 63.4 | 0 |
| Electron, window forced to front | 62.1 | 17.3 ms | 0 | 1.5 / 51.5 / 565 | 0 |
| Tauri, 16 panes | 59.9 | 97 ms | 1 | 1 / 5 / 18 | 0 |
| Electron, 16 panes | 60 | 17.7 ms | 0 | 0.9 / 3.6 / 5.3 | 0 |

**Recommendation.** Against the plan's pass rule, Tauri passes on everything measured here: no context loss at nine or sixteen panes, echo and throughput within the bars, the Rust side can reach the socket and start the holder, live CSS and notifications work (notifications from the bundled app), and no install beyond Rust, which this Mac already had. On "worth switching" it passes on size (about 29 times smaller) and on memory in most pairs (21 to 41 percent lower; the 30 percent bar was met in two of three nine-pane pairs). Three things should be settled before choosing option C: the two unexplained multi-second render stalls in two of eight Tauri runs (never in Electron), which should be re-run on both Macs; the install of Rust on the work Mac, which Tauri adds on top of Node and which option A does not need; and the extra Rust code the window needs (bridge, holder start, notifications, about 90 lines in this spike). If you choose C, run the stall check and the Rust install on the work Mac first.

## Open questions
