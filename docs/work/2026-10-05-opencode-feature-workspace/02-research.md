---
feature: 2026-10-05-opencode-feature-workspace
phase: research
status: draft
version: 5
created: 2026-10-05
updated: 2026-10-05
approved_at:
based_on:
  - 01-questions.md@3
forced: []
repo_heads:
  - grove@15ec3b4
  - grove-skills@b0d2089
  - opencode@v2.0.20 (84c9be9)
  - herdr@e35f393 (v0.9.3)
  - plannotator@ed04a1eb
  - xterm.js@6.0.0
  - node-pty@v1.1.0
  - electron@v44.5.1
---

# Research: feature-focused desktop workspace for OpenCode

Research ran while `01-questions.md` was `status: draft`, version 3 (soft gate).
Citation keys used below: `OC:` = opencode at tag v2.0.20; `HD:` = herdr at
e35f393 (`DOCS` = `docs/next/website/src/content/docs/`); `GS:` =
`~/git/grove-skills` at b0d2089; `old:` = this repo at `f5a1c17`; `XT:` /
`NP:` / `EL:` = xterm.js 6.0.0 / node-pty v1.1.0 / electron v44.5.1;
`tmux.1` = the rendered tmux 3.6b man page; `XIRP:` = the Xirp daemon bundle
(`app.asar` → `@chirp/daemon/dist-external/chunks/index-D7ojYR-e.js`, at a byte
offset). "Observed" means a command was run on this machine on 2026-10-05.

## Summary

- tmux 3.6b is installed. Xirp 0.45.0 runs each agent in a detached session on the default tmux server, named `xirp-<uuid>` (observed), and attaches to it through node-pty.
- herdr 0.9.3 (not installed) is a client/server multiplexer. You control it over an NDJSON Unix socket and a CLI. Its pushed agent-state events come from polling the screen inside the server. Pane ids persist across a restart but processes do not.
- OpenCode 2.0.20 is installed. Its TUI always talks HTTP to a server: either a shared background service (default port 49374), a private `--standalone` child, or `--server <url>`. The server exposes about 141 `/api/*` operations and an SSE stream at `/api/event`. Busy, finished, permission and question states each have their own event types.
- OpenCode's session store is SQLite at `~/.local/share/opencode/opencode.db`. The real database is still on the v1 schema. Session ids have the form `ses_` plus 26 characters.
- The previous app (f5a1c17) ran the agent TUI in tmux, attached with `node-pty → tmux attach-session`, and rendered it in xterm.js 6. It detected state by matching screen text. Its backlog had an unimplemented plan (T-199) to replace that with the OpenCode SDK and SSE.
- xterm.js 6.0.0 supports truecolor, SGR mouse, the alternate screen and synchronized output. It does not support the kitty keyboard protocol (that is in 6.1 beta, opt-in). Electron's default menu takes a fixed set of Cmd/Ctrl accelerators.
- Grove artifacts have fixed names and a fixed frontmatter contract, configured per repo. Nothing in grove-skills defines multi-repo, hub or `featuresDir` support.
- Plannotator is a browser review tool, invoked as `plannotator annotate <file>`.

## Answers

### Q1. herdr

- **Interface.** herdr has a CLI, a socket API and an agent skill over one control surface (`HD:DOCS/socket-api.mdx:12-18`). The socket carries newline-delimited JSON `{id, method, params}` requests (`:608-621`), at `~/.config/herdr/herdr.sock` or `~/.config/herdr/sessions/<name>/herdr.sock` (`:636-646`). `herdr api schema --json` prints a JSON Schema of the methods (`:25-34`). No HTTP API was found. Most CLI commands print JSON; errors go to stderr as JSON with exit 1, syntax errors exit 2 (`HD:skills/herdr/SKILL.md:45,214`).
- **What create returns.** `workspace create` returns `.result.workspace`, `.tab` and `.root_pane`. `pane split` returns `.result.pane` (`HD:SKILL.md:89`).
  - Id formats: workspace `w1`, tab `w1:t1`, pane `w1:p1`. Closed ids are not reused (`SKILL.md:63-69`; `HD:src/workspace.rs:104-110,143-149`).
  - A pane also has a `terminal_id` of the form `term_<micros hex><counter hex>` (`HD:src/terminal/id.rs:17-22`).
  - Moving a pane to another workspace gives it a new pane id (`HD:socket-api.mdx:290-292`).
- **Ids across restarts.**
  - Workspace ids and tab/pane numbers are persisted and restored (`HD:src/persist/snapshot.rs:52-70`; `restore.rs:327-341`).
  - `terminal_id` is reallocated on restore (`snapshot.rs:100-115`; `restore.rs:451,595,691`).
  - After a server restart only the layout comes back; processes do not survive (`HD:DOCS/session-state.mdx:10-14,31-33`). Detaching a client leaves processes running (`:19-27`).
  - Ids are scoped to one server (`SKILL.md:91`).
- **Agent state.**
  - The states are `idle`, `working`, `blocked`, `done` (idle and not yet seen) and `unknown` (`HD:DOCS/concepts.mdx:43-49`).
  - The server reads the live bottom of the pane and applies detection-manifest rules. Manifests ship with herdr, update remotely, and can be overridden at `~/.config/herdr/agent-detection/<agent>.toml` (`HD:DOCS/agents.mdx:64-66,82-94`).
  - Detection runs every 300 ms, or 100 ms while confirming idle (`HD:src/pane.rs:835-841`; `src/pane/agent_detection.rs:5-6`).
  - Consumers get push events through `events.subscribe`, for example `pane.agent_status_changed`, `pane.agent_detected`, `pane.output_matched` and `pane.exited`. History is not durable: a lagging subscriber gets `events_lost` (`HD:socket-api.mdx:775-824`).
  - Integrations can report state themselves with `pane.report_agent` (`:656-673`).
- **Rendering.** The server owns panes and emulates the terminal with vendored libghostty-vt (`HD:crates/ghostty-vt/Cargo.toml:5`). The client renders, and client and server negotiate snapshot/screen/input codecs (`HD:socket-api.mdx:942-945`). With several clients, the last one to interact controls pane size (`concepts.mdx:73`).
- **Outside access to a pane's stream.** Five routes exist:
  - `herdr terminal attach <terminal_id>`: live ANSI frames plus input, with a single writer (`--takeover`). macOS and Linux only.
  - `terminal session observe`: read-only NDJSON `terminal.frame` records with base64 ANSI. Multiple observers are allowed.
  - `terminal session control`: NDJSON `terminal.input`/`resize`/`scroll`/`mouse` on stdin.
  - `pane.read`: text or ANSI snapshots.
  - `pane.send_text`/`send_keys`/`send_input`: input only.

  Sources: `HD:DOCS/persistence-remote.mdx:109-160`; `SKILL.md:191-198`. The docs describe these frames as rendered output, not raw PTY bytes.
- **Program identifiers.**
  - `pane.report_agent_session` stores an `agent_session_id` and optional `resume_argv`. Both are persisted and used to resume after a restart, e.g. `claude --resume <id>` (`HD:socket-api.mdx:675-719`; `snapshot.rs:108-130`; `session-state.mdx:73-113`).
  - `pane.process_info` returns the foreground pid, argv and cwd (`socket-api.mdx:193-195`).
  - Each pane gets `HERDR_PANE_ID` and related env vars (`:251-255`).

### Q2. tmux (3.6b, `/opt/homebrew/bin/tmux`)

- **Detached sessions.**
  - `new-session -d` sizes the session from `default-size`, observed as `80x24` (`tmux.1:494-500,1603-1605`).
  - `destroy-unattached` is off by default, so an unattached session keeps running (`:1607-1609`). `exit-empty` defaults to on (`:1450-1451`).
  - Session, window and pane ids (`$`, `@`, `%`) stay fixed for the life of the server. Panes receive `TMUX_PANE` (`:362-366`). `kill-server` destroys every session, and no persistence across a server restart is documented (`:452-453`).
  - Observed: the default server on this machine hosts sessions created as early as 2026-05-06.
- **Outside read/write.**
  - Attach through a PTY: client flags `read-only`, `ignore-size` and `active-pane`. `-r` means `read-only,ignore-size` (`tmux.1:418-445`). Size follows `window-size`, observed as `latest`, and `aggressive-resize` (`:1962-1965,1774-1775`). `resize-window` switches `window-size` to `manual` (`:1224-1227`).
  - Control mode `-C`/`-CC`: output arrives in `%begin`/`%end`/`%error` blocks. `%output <pane> <octal-escaped>` carries pane bytes, alongside `%pause`/`%continue`, `%layout-change` and `%subscription-changed` notifications (`:30,2901-2990`). The client sets its size with `refresh-client -C WxH`, controls flow with `-A pane:on|off|pause|continue`, and subscribes to a format, reported at most once a second, with `-B` (`:540-546`).
  - `pipe-pane -O` sends program output to a command, and `-I` types a command's stdout into the pane. One pipe per pane is allowed, and `#{pane_pipe}` shows whether one is active (`:1190-1200,2317`).
  - `capture-pane -p -e -J -S - [-a]` takes a snapshot, including history and the alt screen (`:978-988`).
  - `send-keys -l` sends literal text, `-H` sends hex bytes, and `-M` works only from mouse bindings (`:1327-1340`).
  - The man page says `default-terminal` must be `screen`, `tmux` or a derivative; observed as `tmux-256color` (`:1440-1442`). The outer terminal's RGB/Tc support comes from `terminal-features`/`terminal-overrides` (`:1498-1502,1542`).
  - The `mouse` option is off by default (`:1667-1668`). Per-pane mouse modes show up as `#{mouse_*_flag}` (`:2274-2280`).
- **Sizing, colour and mouse in practice** (from Xirp's live daemon API, `xirp api list`, observed):
  - `terminal:colors` copies xterm.js fg/bg into the tmux pane style "so a detached session can still answer an agent's OSC 10 and OSC 11 color queries".
  - `terminal:repairMouseReporting` exists because "tmux believes the client still has the mode and will not re-emit on its own". It reads the mode back from tmux and replays it to the client.
- **Metadata and signals.**
  - Pane formats: `pane_id`, `pane_pid`, `pane_tty`, `pane_current_command`, `pane_current_path`, `pane_start_command`, `pane_title`, `pane_dead*`, `pane_in_mode`, `pane_width`/`height` (`tmux.1:2289-2328`), and `alternate_on` (`:2204`).
  - Activity formats: `window_activity` and `window_activity_flag`/`window_silence_flag` (`:2212,2346,2386-2387`).
  - `monitor-activity` and `monitor-silence <secs>` options (`:1827-1836`).
  - Hooks: every control-mode notification except `%exit`, plus `alert-activity`/`-silence`/`-bell`, `pane-died` (requires `remain-on-exit`), `pane-exited`, `pane-focus-in`/`-out` and `client-attached`/`-detached`/`-resized` (`:2015-2093`). There are also `wait-for` channels (`:2807`).

### Q3. OpenCode CLI surface (v2.0.20, Homebrew)

- **TUI flags.** `opencode [<directory>]` takes `--standalone`, `--server <url>`, `--auto`, `-c/--continue`, `-s/--session <id>` ("continue, or create if it does not exist") and `--prompt <text>` (`OC:packages/cli/src/commands/commands.ts:38-58`). Hidden aliases `--yolo` and `--dangerously-skip-permissions` map to `--auto` (`:31-35`; `handlers/default.ts:100`).
- **No `--model`/`--agent` on the TUI.** The full TUI has no such flags. Its `Args` type has `model` and `agent` (`OC:packages/tui/src/context/args.tsx:4-13`), but the handler doesn't pass them (`default.ts:95-101`).
- **`--prompt`.** The text goes into the composer and is auto-submitted once an agent and model are ready (`OC:tui/src/routes/home.tsx:53-79`). Text starting with `/` that matches a server command goes to `session.command` (`component/prompt/index.tsx:1137-1153,1314-1330`). This comes from reading the source; it was not run end to end.
- **Continue and resume.**
  - `-c` opens the newest top-level session for the current directory (`OC:tui/src/app.tsx:656-680`).
  - `-s <id>` opens that session if it exists. Otherwise it uses the id for the first new session (`default.ts:53-61,97-98`).
- **Other commands.**
  - `opencode mini` (minimal UI) does take `-m/--model`, `--agent`, `--prompt`, `-c`, `-s` and `--fork` (`commands.ts:340-375`).
  - `opencode run [message]` is non-interactive: `--format json`, `-m`, `--agent`, `-f`, `--auto` (`:376-417`).
  - `session list|delete|export|import` (`:418-470`).
  - `opencode api <op>` calls the running server (`:100-116`).
- **Server commands.** `opencode serve [--hostname --port --cors --service --stdio]` (`:537-550`) and `opencode service start|restart|status|stop|get|set|unset`. The settable keys are disabled, hostname, port, password, cors and env (`OC:cli/src/services/service-config.ts:13-24`).
- **TUI ↔ server.** The TUI never hosts the server. It always connects over HTTP, in one of three modes (`OC:cli/src/services/server-connection.ts:21-51`):
  1. `--server <url>`: Basic auth with user `opencode` and `OPENCODE_PASSWORD`. A version mismatch only produces a warning.
  2. `--standalone` (or service `disabled: true`): spawns a private `opencode serve --stdio --port 0` with a random password. The child reports `{"url":…}` on stdout and exits when its stdin closes (`standalone.ts:18-56`; `server-process.ts:163-210`).
  3. Default: a shared detached `opencode serve --service`. A service on a different version gets replaced (`service-config.ts:112-124`; `default.ts:38-46`). The service `chdir`s to `$HOME` (`server-process.ts:55`). It registers `{id, version, url, pid, password}` with mode 0600 in `~/.local/state/opencode/service.json` and exits if another instance replaces that file (checked every 5 s) (`service-registration.ts:23-66`).
- **Port selection.** `--port`, then the service config `port`, then the service default `0xc0de` = 49374 on the latest channel (`service-config.ts:35-39`; `server-process.ts:61-62`). Standalone always uses port 0. If the service port is held by something that isn't OpenCode, startup fails with a message pointing at `opencode service set port` (`server-process.ts:144-158`).
- **Auth.** An unauthenticated `GET /api/info` returned `401 Basic` (observed, throwaway server).
- **Service state on this machine** (observed 2026-10-05). While no OpenCode process was running, nothing listened on TCP 49374 (`lsof -nP -iTCP:49374 -sTCP:LISTEN` returned nothing) and `~/.local/state/opencode/service.json` was absent. After the human launched the OpenCode TUI, `service.json` existed. With the TUI running, an `opencode` process (pid 99956) was listening on `127.0.0.1:49374`, the default service port. That matches the default launch path's `Service.ensure` registration (`OC:service-config.ts:112-124`; `service-registration.ts:23-38`). Its contents were not read because it holds the server password.

### Q4. OpenCode state

- **HTTP surface.**
  - `GET /openapi.json` lists 141 operations under the title "Experimental HttpApi surface" (observed).
  - Relevant routes:
    - `GET /api/info` returns `{version, pid, urls, paths}`.
    - Session routes: `GET/POST /api/session`, `GET /api/session/active`, `/api/session/{id}` and its `prompt`, `command`, `interrupt`, `fork`, `message`, `diff`.
    - Permissions: `GET /api/permission/request` and `POST /api/session/{id}/permission/{requestID}/reply` with body `{decision: once|always|reject}` (`OC:packages/protocol/src/groups/permission.ts:117-125`).
    - Forms: `GET /api/form` and `POST /api/session/{id}/form/{formID}/reply` with body `{answer: Record<…>}` (`protocol/src/groups/session.ts:840-846`).
  - `GET /api/session/active` maps sessionID → `{type:"running"}` for executions this server process owns (`OC:packages/server/src/handlers/session.ts:179-183`).
- **SSE `GET /api/event`.**
  - Documented as "Volatile by contract: a slow consumer overflows and fails the stream, and events during disconnection are missed" (`OC:protocol/src/groups/event.ts:44-53`).
  - Each subscriber has a 4,096-event buffer (`server/src/event-feed.ts:8,64-68`).
  - Frames are `data: <JSON>` only. `server.connected` comes first, then a `: heartbeat` every 15 s (`server/src/handlers/event.ts:14-22`; observed).
  - Envelope: `{id:"evt_…", type, created, data, location?:{directory}, metadata?}`. Durable events also carry `durable:{aggregateID, seq, version}` (`OC:packages/schema/src/event.ts:9-12,60-133`).
- **State events.**
  - **Busy:** `session.execution.started {sessionID}`. During the run you also get `session.step.*`, `session.text.*`, `session.reasoning.*`, `session.tool.*`, `session.retry.scheduled` and `session.compaction.*` (`OC:packages/core/src/session/execution.ts:115`; `schema/src/session-event.ts:242-627`).
  - **Ended:** `session.execution.succeeded`, `failed {error}` or `interrupted {reason: user|shutdown|superseded|inactivity}` (`execution.ts:125-139`). The TUI's notification plugin counts `started` as busy and the other three as ended (`OC:tui/src/feature-plugins/system/notifications.ts:58-61`).
  - **Legacy:** `session.status` (idle/busy/retry) and the deprecated `session.idle` are still in the manifest, but no publisher was found in `core` or `server` (`schema/src/session-status-event.ts:9-53`; `event-manifest.ts:75`).
  - **Permission:** `permission.asked {id:"per_…", sessionID, action, resources[], source?:{type:"tool", messageID, id}, message?}`, then `permission.replied {sessionID, requestID, reply}` (`OC:core/src/permission.ts:217`; `schema/src/permission.ts:25-52`).
  - **Question:** the `question` tool calls `forms.ask`, which emits `form.created {form:{id:"frm_…", sessionID, title:"Questions", metadata:{kind:"question"}, fields:[q0…]}}`. It is settled by `form.replied {id, sessionID, answer}` or `form.cancelled` (`OC:core/src/tool/plugin/question.ts:62-127`; `core/src/form.ts:141`; `schema/src/form.ts:169-171`).
- **On disk.**
  - The store is SQLite at `$XDG_DATA_HOME/opencode/opencode.db` (default `~/.local/share/opencode/`); `OPENCODE_DB` overrides it (`OC:packages/cli/src/database-path.ts:4-13`).
  - The v2 schema has tables `session_v2`, `session_message`, `session_pending`, `session_inbox` and `event` (`OC:core/src/session/sql.ts:22-98`).
  - The real database, opened read-only, has only v1 tables (`session`, `message`, `part`, …). Its newest sessions have `version` 1.14.30 (observed).
  - A v1→v2 migration exists (`OC:core/src/database/v1-migration.bun.ts:493-516`). Its status is available at `GET /api/experimental/migration/v1`.
- **Session ids.** `ses_` plus 26 characters: 12 hex characters of bit-inverted (time-ms × 0x1000 + counter), so ids sort newest first, then 14 base62 characters (`OC:schema/src/session-id.ts:5-8`; `identifier.ts:1-30`). Example: `ses_196eb5313ffeOefUbdZ2K3kmXc`.

### Q5. The previous grove app (f5a1c17)

- **IPC.**
  - Main: a single-instance lock and one `BrowserWindow` with `contextIsolation: true` and the default sandbox (`old:src/main/index.ts:15-25,51-55`).
  - Handler groups are registered in `old:src/main/ipc/index.ts:15-29`. One `PtyManager` is shared by the pty and taskTerminal handlers.
  - Request/response uses `ipcMain.handle`, returning `{ok,data}|{ok:false,error}`. Keystrokes and resizes are fire-and-forget through `ipcMain.on`. Pushes go out through `webContents.send` (`pty:data`, `pty:exit`, `workspace:dataChanged`, `fs:*Changed`, `workspace:branchChanged`) (`old:src/main/ipc/pty.ts:10-47`).
  - The preload exposes one `window.api` with namespaced `on*` subscriptions that return unsubscribe functions (`old:src/preload/index.ts:3-215`).
  - Mismatches: `taskterm.refresh` and `taskterm.cleancontext` have no main handler (`:185-190`). taskTerminal.ts references `state.getContainerSession`/`getContainerService` without importing them (`old:src/main/ipc/taskTerminal.ts:298-436`).
- **PTY handling.**
  - `PtyManager` spawns a login shell (80×24) or any command (200×50, used for `tmux attach-session`) with `xterm-256color` (`old:src/main/pty.ts:39-151`).
  - It buffers all output without a limit (`:86-90`). "Idle" means no output for 3 s (`:205-209`).
  - A WeakSet together with an `isCurrent` check suppresses exit events from replaced instances (`:16-18,94-100`).
- **taskTerminal.**
  - One tmux session per task and mode, named `grove-term-<sha256(ws)[0:6]>-<taskId>-<plan|exec>` (`old:src/main/ipc/taskTerminal.ts:1-23,42-53`).
  - It is created with `tmux new-session -d … env TERM=xterm-256color PATH=… bash -c 'opencode "<cwd>" [--model github-copilot/<m>]'`, with the status bar turned off (`:68-133`).
  - The session name is persisted to task frontmatter (`:189-268`). Reconnect always spawns a fresh attach so tmux redraws (`:270-355`).
  - State is "active" when the captured pane contains "esc" and "interrupt", otherwise "waiting" (`:156-172`).
  - `opencodeConfig.ts` merges `permission.doom_loop: "allow"` into `~/.config/opencode/opencode.json`, and the cleanup step then deletes that file (`old:src/main/opencodeConfig.ts:12-74`; see backlog T-196).
- **Renderer.**
  - `TaskTerminal.tsx` uses xterm with Fit and WebLinks addons. Resize is debounced 100 ms through a ResizeObserver (`old:src/renderer/src/components/TaskDetail/TaskTerminal.tsx:2-5,346-360`).
  - Context injection polls `pty.isIdle`, writes the text, waits 300 ms and then sends `\r` (`:415-457`).
  - `injectContext.ts` adds per-agent ready regexes and retries (`old:src/renderer/src/utils/injectContext.ts:15-117`).
- **File watching.**
  - chokidar watches `.grove/tasks/**/*.md` (awaitWriteFinish 150/50 ms, ignores `*.tmp`) → `workspace:dataChanged`.
  - It also watches the workspace tree at depth 20 with a 500 ms debounce → `fs:treeChanged`, and single open files → `fs:fileChanged` (`old:src/main/watchers.ts:18-90`).
  - Worktree task files are synced back after a 300 ms debounce (`old:src/main/ipc/git.ts:36-140`). `.git/HEAD` is watched with `fs.watch` (`old:src/main/ipc/workspace.ts:86-121`).
  - Writes are atomic: write `.tmp`, then rename (`old:src/runtime/fileWriter.ts:4-23`).
- **Frontmatter.**
  - Parsed with `gray-matter` (`matter`/`matter.stringify`) in `old:src/runtime/taskService.ts:26-130`. Each field is type-checked.
  - `updateTask` takes a per-file promise lock and writes atomically (`:13-22,252-292`).
  - The renderer also regex-parses frontmatter in `readFreshFrontmatter` (`TaskTerminal.tsx:548-598`).
- **"Stream opencode" plan (T-199, backlog, unimplemented).** The plan, from `.grove/tasks/backlog/T-199.md:11-92`:
  - Use `@opencode-ai/sdk/v2` with one `opencode serve` per worktree, auto-detected via a health check on port 4096.
  - Sessions are adopted with `session.list()`, and `event.subscribe` is relayed to per-task IPC.
  - React components replace xterm, keyed on event names such as `message.part.updated`, `tool.use` and `session.idle`.
  - tmux stays the path for other agents.

  Those event names do not match the v2.0.20 event types in Q4. The SDK was not a dependency at f5a1c17.
- **Recorded problems** (`.grove/tasks/…`, identical at HEAD and f5a1c17):
  - **xterm:** T-104/T-105 (the private `_core._terminalEl` is gone in v6, so blank remounts; fixed by re-parenting `term.element`), T-197 (orphaned listeners on remount), T-189 (hidden tabs respawned the PTY), T-193 (wheel capture by the Claude TUI).
  - **PTY/tmux:** T-165 (3 s idle ≠ ready, lost Enter; fixed with a marker handshake), T-119/T-133 (stale frontmatter caused re-injection loops), T-113 (two session architectures coexisted), T-145/T-123 (session lifecycle on status change), T-022 (FIFO with a 64 KB pipe buffer), T-007 (native rebuild, `asarUnpack`).
  - **OpenCode:** T-064/T-023/T-029 (`run --format json` parsing), T-067/T-095 (false "agent exited" warnings), T-125 (`external_directory` permission prompts), T-129/T-143 (the "esc"+"interrupt" heuristic), T-196 (config overwrite and delete), T-179 (headless path removed).
- **Versions** (`old:package.json`): electron ^39.2.6 (lock 39.8.6), node-pty ^1.1.0, @xterm/xterm ^6.0.0, addon-fit ^0.11.0, addon-web-links ^0.12.0, chokidar ^3.6.0, gray-matter ^4.0.3, mermaid ^11.6.0, electron-vite ^5, electron-builder ^26.0.12, vitest ^4.1.2.

### Q6. xterm.js + node-pty inside Electron

- **Current versions** (npm, 2026-10-05): `@xterm/xterm` 6.0.0 (beta 6.1.0-beta.304), `@xterm/addon-webgl` 0.19.0, `node-pty` 1.1.0 (beta 1.2.0-beta.15), `electron` 44.5.1, `@electron/rebuild` 4.2.0.
- **What OpenCode's TUI emits.** OpenCode 2.0.20's TUI depends on `@opentui/core`/`keymap`/`solid` (`OC:packages/tui/package.json:90-92`). OpenTUI (read at HEAD `de8dc97`, version not pinned to OpenCode's catalog) emits:
  - `?1049` alt screen (`opentui:packages/core/src/ansi.ts:2-3`);
  - mouse modes ?1000/1002/1003/1006, focus ?1004 and bracketed paste ?2004;
  - kitty keyboard protocol and modifyOtherKeys (`opentui:packages/native/src/terminal.zig:1040-1070`);
  - RGB colour only when `COLORTERM` is truecolor/24bit (`:820-826`);
  - DECRQM/XTVERSION/kitty probes.
- **Truecolor.** SGR 38/48;2 is parsed (`XT:src/common/InputHandler.ts:2324-2330`). node-pty sets `TERM` but not `COLORTERM` (`NP:src/unixTerminal.ts:23,72-73`).
- **Mouse.**
  - Supported: DECSET 9, 1000, 1002, 1003, 1006, 1016 and 1004. 1005 and 1015 are unsupported (`XT:InputHandler.ts:1919-1953`).
  - Wheel: passed to the app if it requested mouse events; otherwise turned into arrow keys on the alt screen (`XT:src/browser/CoreBrowserTerminal.ts:806-841`).
  - Selecting text while mouse mode is on needs Shift, or Option on macOS only when `macOptionClickForcesSelection` is set, which defaults to false (`XT:SelectionService.ts:437-443`; `OptionsService.ts:41`).
- **Alt screen and sync.** 47/1047/1049 are supported, as are 2004 and 2026 synchronized output (new in 6.0, with a 1000 ms safety timeout) and DECRQM (`XT:InputHandler.ts:267-268,1959-1974`; `RenderService.ts:340-351`). There is no XTVERSION handler in 6.0.0; it is present in the 6.1.0-beta.304 bundle.
- **Keyboard protocol.**
  - In 6.0.0, Shift+Enter sends `\r`, the same as Enter (`XT:src/common/input/Keyboard.ts:100-104`). There are no kitty/CSI u handlers.
  - Kitty keyboard support landed on master in PR #5600 as opt-in `vtExtensions.kittyKeyboard` (default false) and is present in 6.1.0-beta.304.
  - `attachCustomKeyEventHandler` runs before xterm's own handling (`XT:typings/xterm.d.ts:1043-1072`).
- **Resize.**
  - `term.resize` fires `onResize`; the docs advise debouncing (`XT:typings/xterm.d.ts:1028-1034`). The fit addon derives cols and rows from element and cell size (`XT:addons/addon-fit/src/FitAddon.ts:51-88`).
  - `pty.resize` issues `TIOCSWINSZ` (`NP:src/unix/pty.cc:503-522`). Nothing links the two automatically.
- **WebGL.**
  - 6.0 removed the canvas renderer, leaving DOM (the default) or WebGL (6.0.0 release notes).
  - WebGL needs WebGL2 (`XT:addons/addon-webgl/src/WebglRenderer.ts:88-90`). The browser can drop the context; the addon exposes `onContextLoss`.
- **Keys captured before the PTY.**
  - **Electron's default menu** is installed unless the app sets its own (`EL:lib/browser/init.ts:181`). It binds Cmd+W, C, X, V, A, Z, Shift+Z, R, Shift+R, H, Alt+H, M, Q, 0, +, -, Alt+I and Ctrl+F (`EL:lib/browser/api/menu-item-roles.ts:78-246`). The documented ways to stop that are `Menu.setApplicationMenu(null)`, `before-input-event` + `preventDefault()`, and `webContents.setIgnoreMenuShortcuts(true)` (`EL:docs/api/menu.md:29-48`; `web-contents.md:517-540,1458-1462`).
  - **macOS** takes Cmd+Tab, Cmd+Space, Ctrl+Space, Cmd+Shift+3/4/5, Ctrl+Up/Down/Left/Right, Cmd+` and Ctrl+Cmd+Q (support.apple.com/en-us/102650).
  - **xterm 6.0.0:**
    - Cmd combinations produce no sequence, and Cmd+A selects all.
    - Shift+PageUp/Down scroll the viewport instead of reaching the PTY. Shift+Insert and Ctrl+Insert are not sent.
    - `macOptionIsMeta` defaults to false, so Option composes characters (`XT:Keyboard.ts:113-356`; `OptionsService.ts:40`; `CoreBrowserTerminal.ts:1105-1116`).
- **node-pty against Electron's ABI.**
  - Electron documents three routes: `@electron/rebuild`, `npm_config_runtime/target/disturl` env vars, or `node-gyp --dist-url` (`EL:docs/tutorial/using-native-node-modules.md:1-116`).
  - node-pty 1.1.0 is a Node-API addon (`NP:binding.gyp:3-5`; `pty.cc:799`). The tarball has prebuilds for darwin-arm64/x64 and win32-arm64/x64, and none for Linux.
  - Install runs `prebuild.js || node-gyp rebuild`; `npm_config_build_from_source=true` forces a build. At load time `build/Release` takes precedence over the prebuilds (`NP:src/utils.ts:12-28`).
  - `spawn-helper` paths are rewritten to `app.asar.unpacked` (`NP:unixTerminal.ts:17-20`).
  - The 1.1.0 darwin `spawn-helper` ships with mode 644, which causes `posix_spawnp failed` (node-pty issue #850; the fix is reported to be in 1.2.0-beta).
  - Renderers are sandboxed by default, so node-pty loads in main or another Node-enabled process (`EL:docs/tutorial/sandbox.md:15`). The old app used `asarUnpack: node_modules/node-pty/**`, `npmRebuild: true` and a postinstall of `electron-builder install-app-deps` (`old:electron-builder.yml:12,14,41`).

### Q7. Grove artifact formats today

- **Layout.** Features live at `<artifactRoot>/<slug>/`, with `docs/work` as the default. Epics and children sit flat side by side. A feature is found with a flat scan of `*/feature.md`. Slugs are `<TICKET>-<kebab>` or `<YYYY-MM-DD>-<kebab>` (`GS:shared/contract.md:9-16,34-35`).
- **Fixed names.** `feature.md`, `00-ticket.md` (no frontmatter), `01-questions.md`, `02-research.md`, `03-design.md`, `04-structure.md`, `05-plan.md` and `06-implementation.md` (no 05/06 for epics). `.html` files come only from grove-render (`GS:contract.md:42-53`). `grove.config.json` sits at the repo root with keys `artifactRoot`, `adrDir`, `contextFile`, `commitHtml`, `tracker`, `commands`, `limits` (`additionalProperties: false`) (`GS:shared/config.schema.json:6-23`).
- **`feature.md` frontmatter:** `kind` (epic|feature), `parent`, `children` (epic only, written by grove-approve), `appetite`, `order` (child only; 1 = walking skeleton), `created`. It has no phase/status/version (`GS:contract.md:54-75`). An epic body requires Problem, Who it's for, Success looks like, Non-goals and Appetite (`:79-83`). A `FLAGGED.md` appears in fixtures but is not defined in the contract.
- **Phase artifact frontmatter:** `feature`, `phase`, `status` (draft|approved|stale), `version`, `created`, `updated`, `approved_at`, `based_on` (`file@version`, plus `parent:file@version`), `forced`, and `repo_heads` (research only) (`GS:contract.md:85-105`).
- **Approval on disk.** grove-approve sets `status: approved` and `approved_at`, and flips drafted ADRs from Proposed to Accepted (`GS:skills/grove-approve/SKILL.md:60-61,84-85`). grove-plan sets `status: approved` on `05-plan.md` itself when its self-checks pass (`GS:skills/grove-plan/SKILL.md:54-60`), which differs from `GS:shared/gates.md:47,80-83` and AGENTS.md.
- **Stale.** `stale` is a `status` value. Editing an approved artifact resets it to draft and marks downstream artifacts stale (`GS:contract.md:141-143`), and so does approving one (`grove-approve/SKILL.md:62-65`). Separately, a `based_on` version older than the input's current version stops the consuming skill (`gates.md:51-57`). When an epic design is re-approved, only children that cite a changed `E-D` id are marked stale, or every child if Problem, Non-goals or Appetite changed (`gates.md:59-76`).
- **Epics on disk.** An epic runs only Questions through Structure (`contract.md:26-28`). The first approval of its structure creates child folders with `feature.md` (`kind: feature`, `parent`, `order`) and fills `children:`. Removed children are flagged, never deleted (`grove-approve/SKILL.md:72-83`). Child status is derived on read by `grove-epic-status` (`contract.md:36-38`). `GS:docs/app-changes.md:9-72` is a note addressed to "a workspace app that reads `docs/work/`", describing the stage order backlog → … → done.
- **Multi-repo and hub.** No `hub`, `featuresDir`, multi-repo or per-repo artifact-name concept exists in grove-skills. The schema rejects unknown keys. The only per-repo hint is `repo_heads` (`GS:contract.md:102-103`).
- **Installation.** `~/.claude/skills/grove-*` and `~/.config/opencode/commands/grove-*.md` are symlinks into grove-skills (`GS:install.sh:56-65`). `grove-epic-status` and `grove-spike` exist in the repo but are not linked.

### Q8. Xirp (0.45.0, edition `external`)

- **CLI.** `~/.local/share/chirp/cli/external/xirp` is a shell launcher that sets `CHIRP_DATA_DIR=~/.chirp` and execs `/Applications/Xirp.app/Contents/Resources/chirp-cli/xirp` (`xirp:11-18`). Commands:
  - `session new|list|get|stop|delete|goal|update|reparent|new-terminal|message|import|attach|upload`
  - `project add|list|edit|remove`
  - `api list|describe|send`, `features`, `skill`, `update`, `edition`

  There is no `status` command; use `session list --status …` / `session get`.
- **Daemon API.** The CLI talks to a WebSocket at `ws://localhost:51477` (Unix socket `~/.chirp/ipc/daemon-external.sock`). `xirp api list` (observed) includes:
  - `sessions:list`, `session:get/create/stop/resume/fork/message`, `sessions:restorable`, `sessions:restore-bulk`
  - `tmux:status`, `tmux:orphaned-sessions`, `tmux:adopt-session`, `tmux:kill-orphaned`
  - `terminal:join/leave/input/resize/colors/repairMouseReporting/visibility`
  - `permission:list/respond`, `messages:list`, `message:send`, `files:watch`

  `xirp features` lists 26 modules, including `workflow-status`.
- **Status detection.**
  - Statuses are `running`, `waiting`, `waiting_on_parent`, `finished`, `idle`, `paused`, `completed` and `failed` (`XIRP@144335,144977`). Observed: `xirp session list` shows a STATUS column (`running`/`idle`/`completed`) and a separate WORKFLOW column (`in_progress`).
  - Primary signal: generated Claude hook scripts (`~/Library/Application Support/Xirp/xirp-external/hook-scripts/claude/*.cjs`) POST `{schema:"squab.hook/v1", agent, kind, ts, sessionId, payload, chirpSessionId}` to `http://localhost:51477/chirp/hook/squab/v1`. Failed posts spool to disk (`stop.cjs:5,102-149`), and only loopback is accepted (`XIRP@1085120`).
  - `preToolUse` sets running. `stop` sets idle if a viewer is attached, otherwise finished. `permissionRequest`/`notification` set waiting. Every change passes through a `statusArbiter` that broadcasts `session:updated` (`XIRP@648560,653081,698421,698965`).
  - Secondary signal: per-agent pane-text evidence polling, e.g. every 500 ms matching "esc to interrupt" (`XIRP@580365,653081`), plus `#{pane_dead}` probes (`XIRP@222771`).
- **Staying alive.**
  - Each agent runs in `tmux new-session -d -s xirp-<session uuid>` on the default tmux server. The env includes `CHIRP_SESSION_ID`, `COLORTERM=truecolor` and `FORCE_COLOR=3`. Session options: `mouse on`, `status off`, `history-limit 50000`, `allow-passthrough on`, `remain-on-exit failed` (`XIRP@204336,210997,214573,219374`).
  - Observed: 11 `xirp-*` sessions on the default server next to non-Xirp sessions, while `xirp session list --limit 5` printed 4 sessions.
  - The UI attaches with `pty.spawn(tmux, ["-u","attach","-t",name])` (`XIRP@223599`).
  - Closing the window hides it (a `close` handler calls `preventDefault()` and `hide()`, and there is a tray menu), and the daemon is an Electron utilityProcess (`dist/main.js`).
  - On shutdown only the attach PTYs are killed (`XIRP@229302,255713`). A lost tmux server shows as a resumable state (`XIRP@144523`).

### Q9. Sandboxed artifact HTML in Electron

- **Common.**
  - An iframe with `sandbox` and no `allow-same-origin` gets an opaque origin. Scripts need `allow-scripts`. Combining `allow-scripts` with `allow-same-origin` on a same-origin document lets it lift its own sandbox (MDN `<iframe>`).
  - Electron's `protocol.handle` sees requests from opaque frames with `initiatorOrigin === null` (`EL:docs/api/protocol.md:135-140`).
  - Mermaid 12.1.0 injects a `<style>` through `innerHTML`, so a CSP must allow inline styles (`mermaid:packages/mermaid/src/mermaidAPI.ts:605-607`). Its own `securityLevel: 'sandbox'` renders into a sandboxed `data:` iframe (`:66,386`).
- **`file://`.**
  - Electron's security checklist item 18 advises against `file://` (`EL:docs/tutorial/security.md:780-799`).
  - The `grantFileProtocolExtraPrivileges` fuse is on by default. It gives `file://` child frames universal access "regardless of sandbox settings" (`EL:docs/tutorial/fuses.md:131-149`).
  - CSP can only be set through `<meta>`, and `<meta>` can't carry the CSP `sandbox` directive (`security.md:403-413`; CSP3 §3.3).
- **Custom protocol.**
  - `registerSchemesAsPrivileged` must run before `ready`, once. The privileges `standard`, `secure`, `bypassCSP`, `supportFetchAPI`, `corsEnabled`, `stream` etc. all default to false (`EL:docs/api/protocol.md:72-123`; `structures/custom-scheme.md`). Without `standard`, relative URLs don't resolve and storage is disabled.
  - `protocol.handle` returns a `Response`, so the app sets the headers, including a header CSP with `script-src` hosts and the `sandbox` directive (`security.md:381-401`).
  - The parent's `frame-src`/`child-src`/`default-src` must allow the scheme. The old app's renderer CSP was `default-src 'self'; …` (`old:src/renderer/index.html:8`).
- **`srcdoc`.** The URL is `about:srcdoc`, with the parent's URL as base. The policy container is cloned from the parent, so the parent's CSP applies inside it (WHATWG HTML source at `4c5586a`, "determine navigation params policy container"). An inner `<meta>` CSP can only tighten it. Isolation comes from `sandbox` without `allow-same-origin`.
- **`<webview>`.** Off by default; it needs `webPreferences.webviewTag: true`. Electron currently recommends against it, citing Chromium architectural changes, and lists iframe or `WebContentsView` as alternatives (`EL:docs/api/webview-tag.md:1-33`). It runs in a separate process. `will-attach-webview` can rewrite or block the guest's preferences (`web-contents.md:981-996`).
- **Subframe defaults.** `nodeIntegrationInSubFrames` is opt-in (off). `webSecurity` defaults to true (`EL:docs/api/structures/web-preferences.md:6-49`).

### Q10. Plannotator

- **What it is.** A local, browser-based review surface where agents' plans, markdown, HTML and diffs are annotated and the feedback is returned to the agent. It supports Claude Code, OpenCode, Codex and others; MIT/Apache licensed (`github.com/backnotprop/plannotator` README:38-42).
- **Install.**
  - `curl -fsSL https://plannotator.ai/install.sh | bash` (`-s -- --minimal` installs only the binary, to `~/.local/bin`).
  - Claude Code: `/plugin marketplace add backnotprop/plannotator`.
  - OpenCode: `"plugin": ["@plannotator/opencode@latest"]` in `opencode.json` (README:201-234).
  - Not installed on this machine, and nothing in grove or grove-skills references it.
- **Opening a file.** `plannotator annotate <file.md|.txt|.html|URL|folder/>`. The target is `args[1]`, resolved against `PLANNOTATOR_CWD` or the current directory (`apps/hook/server/cli.ts:232-250`; `index.ts:1351-1356`).
  - Flags: `--gate` (adds an Approve button), `--json`, `--require-approval` (needs `--gate --json`, exits 1 unless approved), `--result-file <path>`, `--hook`, `--markdown`, `--render-html`, `--app`/`--static`, `--no-jina`, `--tailscale` (`cli.ts:90-110,232-250`; `index.ts:375-389`).
  - Output: `approved` / `dismissed` / `annotated`, as text or as JSON `{decision, feedback?}` (`apps/skills/claude/plannotator-annotate/SKILL.md:16-21`).
  - Env: `PLANNOTATOR_PORT`, `PLANNOTATOR_REMOTE`, `PLANNOTATOR_BROWSER` (README:491-494).

## Current architecture

```mermaid
flowchart LR
  subgraph Grove repo files
    A["docs/work/&lt;slug&gt;/*.md<br/>frontmatter contract"]
    H["*.html via grove-render"]
  end
  subgraph tmux default server
    T1["xirp-&lt;uuid&gt; sessions"]
    T2["other sessions"]
  end
  subgraph OpenCode 2.0.20
    TUI["opencode TUI (OpenTUI)"]
    SVC["opencode serve --service<br/>:49374, Basic auth"]
    DB[("~/.local/share/opencode/opencode.db")]
  end
  subgraph Xirp app
    XUI["Electron renderer (xterm.js)"]
    XD["daemon utilityProcess<br/>ws://localhost:51477"]
  end
  TUI -- "HTTP + SSE /api/event" --> SVC
  SVC --> DB
  T1 -- runs --> TUI
  XD -- "node-pty: tmux attach / capture-pane / send-keys" --> T1
  XD <-- "terminal:* over WebSocket" --> XUI
  TUI -. "Claude hooks POST squab.hook/v1" .-> XD
  OLD["previous grove app (f5a1c17)<br/>node-pty → tmux attach → xterm.js"] -. "deleted at 15ec3b4" .-> T2
  OLD -. "chokidar + gray-matter" .-> A
  HERDR["herdr (not installed)<br/>NDJSON socket, own server"]
```

## Existing patterns to reuse

- **tmux-hosted agent and PTY attach:** the previous grove app (`old:src/main/ipc/taskTerminal.ts:68-133,189-355`) and Xirp (`XIRP@214573,223599`). Both create a detached session with `new-session -d`, attach through node-pty with `tmux attach`, and re-attach to force a redraw.
- **Main/preload IPC shape:** `IpcResult` handle/return, fire-and-forget `on` for keystrokes, `webContents.send` pushes, one `contextBridge` `window.api` with unsubscribe-returning listeners (`old:src/preload/index.ts:3-215`; `old:src/main/ipc/pty.ts:10-47`).
- **Watch and parse frontmatter:** chokidar with `awaitWriteFinish` and `.tmp` ignore, atomic write-then-rename, gray-matter parse/stringify under a per-file lock (`old:src/main/watchers.ts:18-31`; `old:src/runtime/fileWriter.ts:4-23`; `old:src/runtime/taskService.ts:13-22,252-292`).
- **Status from screen text:** "esc"+"interrupt" in the old app (`old:taskTerminal.ts:156-172`), "esc to interrupt" in Xirp (`XIRP@580365`), and manifest rules in herdr.
- **Status from structured signals:** Xirp's hook-POST status arbiter, herdr's `pane.report_agent`, and OpenCode's `session.execution.*` / `permission.asked` / `form.created` events.
- **Packaging node-pty:** `asarUnpack` + `npmRebuild` + `install-app-deps` (`old:electron-builder.yml:12,14,41`).

## Constraints & invariants

- `status: approved` is set only by grove-approve (`GS:gates.md:47,80-83`); grove-plan is the documented exception. `.html` files are generated, never hand-edited (`GS:contract.md:53`).
- `grove.config.json` rejects unknown keys (`GS:config.schema.json:6-7`).
- OpenCode's SSE stream is volatile, and events during a disconnect are lost (`OC:protocol/src/groups/event.ts:44-53`). herdr's event history is not durable either (`HD:socket-api.mdx:794-808`).
- OpenCode server routes need Basic auth. The service password lives in `~/.local/state/opencode/service.json` (mode 0600) or the service config.
- The OpenCode service replaces itself when versions differ (`OC:default.ts:38-46`) and `chdir`s to `$HOME`.
- tmux sessions don't survive a tmux server restart (`tmux.1:452-453`). herdr processes don't survive a herdr server restart.
- Electron renderers are sandboxed by default, so node-pty runs outside the renderer (`EL:sandbox.md:15`).
- node-pty 1.1.0's darwin `spawn-helper` prebuild ships without the exec bit (issue #850).
- Electron's default menu takes Cmd+C/V/W/Q/R/… before the page unless the menu is replaced (`EL:menu-item-roles.ts:78-246`).

## Test landscape

- **HEAD (15ec3b4):** no application code or tests. The repo holds `.grove/`, `docs/`, `AGENTS.md`, `CONTEXT.md` and `grove.config.json`. `grove.config.json` `commands` is `{}`.
- **f5a1c17:** `npm test` = `vitest run` (node environment). The include globs are `src/main/__tests__/**/*.test.ts` and `src/renderer/src/**/__tests__/**/*.test.ts` (`old:vitest.config.ts:4-18`). The tests covered contextGenerator, git branch naming, tasks (against the unused `src/main/tasks.ts`), store performance and usePlanStore. `AgentModelForm.test.tsx` was not matched by the globs. No tests covered pty, xterm, watchers or taskTerminal. Typecheck was `tsc --noEmit` for node and web.
- grove-skills has fixtures under `GS:tests/fixtures/` (e.g. `epic-approve/`); its test runner was not examined.

## Relevant ADRs

None. `docs/adr/` holds only `0000-template.md`, and `CONTEXT.md` defines no terms yet.

## Unknowns

- **herdr:** none of it was observed running, because it isn't installed. Not established: whether `terminal session observe` frames are raw PTY bytes or re-rendered output, and herdr's detection rules for Claude/OpenCode (`HD:src/detect/manifests/`). Resolve by installing herdr and running observe against a pane.
- **tmux access methods:** each method's behaviour for sizing, colour and mouse was not tested directly; the sandbox blocked creating a tmux socket. Resolve with a hands-on test of attach, `-CC` and `pipe-pane` against a running OpenCode.
- **OpenCode:**
  - What port a plain `opencode serve` without `--port` picks.
  - Whether `--prompt "/cmd"` actually runs a command. Also, the live event sequences for busy, permission and question; these came from source only.
  - Whether plugins or the v1 compatibility layer emit `session.status`/`session.idle`.
  - When the real database's v1→v2 migration runs.
- **OpenCode keyboard needs:** whether the TUI requires the kitty keyboard protocol or degrades on xterm 6.0.0. Also whether the `xterm-256color` terminfo advertises RGB for apps that check terminfo instead of `COLORTERM`.
- **Electron:**
  - Whether node-pty's Node-API prebuild loads in Electron 44 without a rebuild.
  - What `electron-builder install-app-deps` runs for node-pty.
  - Whether a page-level `preventDefault()` in keydown blocks macOS menu accelerators.
  - What `corsEnabled` does exactly.
  - Whether Mermaid 12.1.0 calls APIs that throw in an opaque-origin frame.
- **Xirp:**
  - Why the default-server tmux list (11 `xirp-*`) differs from `xirp session list --limit 5` (4).
  - The startup reconciliation path for orphaned sessions.
  - Whether its OpenCode status detection uses hooks or screen evidence; only the Claude hook scripts were read.
- **Previous app:** whether f5a1c17 compiled, given the unimported `state`/`getContainerService`, and whether its tests passed. Resolve by checking out f5a1c17 and running `npm run typecheck && npm test`.
- **grove-skills:**
  - The format of `FLAGGED.md`.
  - Whether `repo_heads` "per repo" implies multi-repo features.
  - Why `grove-epic-status`/`grove-spike` are not linked by `install.sh`.
- **Plannotator:** facts reflect upstream `main` at `ed04a1eb`, not an installed version.

## Open questions
