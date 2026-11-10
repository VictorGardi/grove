---
feature: 2026-11-07-remote-machines
phase: research
status: draft
version: 1
created: 2026-11-07
updated: 2026-11-07
approved_at:
based_on: []
forced: []
repo_heads:
  - ab7b547a4aaf64c3c0b71d1de6265e709d1a8e42
---

# Research: remote machines for Grove next

Facts only. "Grove core" below means the `next/` packages `holder`, `core`, `protocol` and `cli`. Paths are under `next/` unless noted. Read by static reading; the headless start was not run.

## The Raspberry Pi (read-only `ssh pi`)

- Debian 12 (bookworm), aarch64, glibc 2.36, 4 cores, 3.8 GB RAM, 8.9 GB free disk, up 129 days. User `victor`, bash, passwordless sudo, `ssh` service active. Host entry `pi` in `~/.ssh/config` (192.168.0.116, key `~/.ssh/id_ed25519`).
- Present: git, python3, gcc, make, build-essential. Absent: node, npm, bun, cargo/rust, go, tmux. `claude` is at `~/.local/bin/claude`, which is not on the non-interactive ssh PATH.
- `apt` offers nodejs 18.20.4 only. Grove core runs under whatever node is on PATH (local node is v26.3.0; `next/package.json` has no `engines` field and no `.nvmrc`).
- `~/git/grove` on the Pi is an old checkout with no `next/` folder. Ports 80, 8080, 8123, 1880, 1883 and 5433 are in use.

## Processes and transport (core layer)

- Three Node processes, TypeScript run via `node --import tsx` with no build step: holder (`packages/holder/bin.ts`, owns node-pty PTYs plus an `@xterm/headless` terminal per tab), core (`packages/core/bin.ts`, `daemon.ts`, spaces, status, agents, diff, config, integrations), and the CLI (`packages/cli/main.ts`, entry `bin/grove-next`).
- Transport is Unix domain sockets only, in `$GROVE_NEXT_HOME` (default `~/.grove-next`, mode 0700): core `s`, holder `h`, both chmod 0600 (`core/daemon.ts:289`, `holder/server.ts:103`). Paths of 100 bytes or more throw (`protocol/paths.ts`). No token or peer check exists; trust is the directory and socket modes.
- Framing is newline-delimited JSON-RPC 2.0-like (`protocol/framing.ts`, `protocol/client.ts` `connectRpc`). Terminal bytes travel base64 (`dataB64`). `PROTOCOL_VERSION = 1`.
- The core opens one holder connection per client connection (`core/daemon.ts:232`) and relays `tabs.output` and `tabs.exit` to that client. Core-wide events use `broadcast()`.
- The holder supervises the core (`holder/bin.ts` `superviseCore`, restart backoff 250 ms to 8 s, `GROVE_NEXT_CORE_CMD` overrides). Core's `bin.ts` calls `ensureHolder()` which spawns a detached holder if `h` does not answer.
- Headless start today: no daemon-start subcommand exists. `bin/grove-next` only runs the CLI. The Tauri Rust `start_holder()` (`ui/src-tauri/src/lib.rs:61`) is what spawns `node --import tsx packages/holder/bin.ts` detached. Running that command by hand, or `packages/core/bin.ts` alone, is the headless equivalent. Whether the CLI auto-starts a core is unconfirmed (exit code 3 means "core cannot be reached").
- Imports in holder, core, protocol and cli are Node builtins, node-pty, `@xterm/headless` and `@xterm/addon-serialize`; none import Tauri, Rust or Electron.
- macOS-flavoured spots: `core/spaces.ts:477` `loginShell()` prefers `/bin/zsh` if present, else `$SHELL`, else `/bin/sh`; copilot and opencode adapters fall back to `/bin/zsh` for command probes; `holder/pty-table.ts` defaults `LANG=en_US.UTF-8`; `scripts/fix-spawn-helper.mjs` (postinstall) chmods node-pty `spawn-helper`; README prerequisites list Xcode and Rust (for node-pty and Tauri only). No launchd, pbcopy or osascript in the core layer.

## Protocol surface (`protocol/messages.ts`)

- Requests: `core.ping|restart`; `tabs.create|open|list|attach|write|resize|kill|close|rename|focus|screen`; `spaces.list|add|remove|rename`; `worktrees.list|add`; `agents.list`; `attention.focus`; `config.get|setKey`; `notes.read|write`; `diff.*` (get, bases, prefs, comments); `integration.status|install|uninstall|answer`.
- Notifications: `tabs.output`, `tabs.exit`, `status.changed`, `attention.notify`, `tabs.focus`, `tabs.closed`, `tabs.opened`, `spaces.removed`, `spaces.changed`, `config.changed`, `integration.prompt`.
- `spaces.list` returns spaces with tabs (`SpaceInfo {id, path, name, label, repoName, parent, worktree, branch}`; no machine field). `tabs.attach` returns `{screenB64, cols, rows}` then streams `tabs.output`; the core records the attaching socket as tab owner (`daemon.ts` ~L255).

## State, config, agents (on the machine that runs the core)

- `$GROVE_NEXT_HOME/state.json` (versioned spaces and tabs), `config/` (`settings.json`, `keys.json`, `launchers.json`, `theme.json`, `layout.json`, via `core/config/*`; `config.get` returns a snapshot, `config.changed` notifies), `notes.md`, `agents/<kind>/<tabId>.jsonl` spools read by fs.watch plus a 1 s poll. After a reboot, tabs return as fresh login shells in the space's folder.
- Claude hook script `core/agents/claude/hook.mjs` appends to the spool; copilot hooks append shell-side; opencode status comes from `~/.local/state/opencode/service.json`. `integration.install` edits `~/.claude/settings.json` and `~/.copilot/settings.json` of the box that runs the core, with a backup. All of it is local to the box running core and holder.
- Nothing in `next/` mentions ssh, machines or remote hosts (greps found only git "remote-tracking" text). `docs/work/2026-11-04-grove-v2-spaces-tabs/02-research.md` surveys herdr, which carries its protocol over `ssh box <cli> connect` stdin/stdout.

## UI (`packages/ui`, `ui/src-tauri`)

- Chain: page `ui/bridge.ts` → Tauri commands in `src-tauri/src/lib.rs` (`connect`, `rpc`, `env_info`, `notify`, `play_sound`, `raise_window`, `install_cli`) → one `UnixStream` to `~/.grove-next/s`. Rust holds a single global connection (`Shared{writer, pending, events}`), reconnects with backoff, starts the holder if `h` is dead, emits synthetic `bridge.closed` on EOF. `rpc()` has a 30 s timeout. The page depends only on `interface Bridge {connect, rpc, on, onStatus}` (`createBridge()` is the one implementation); no host or machine concept, no TCP, no auth.
- Terminals: no separate stream; output is the `tabs.output` notification, input is `tabs.write`/`tabs.resize`. `attachScreen()` (`main.ts` ~L581) attaches and replays; `resync()` (~L1092) calls `spaces.list` and attaches every alive tab.
- Sidebar: static markup in `ui/index.html` L15-45 (`#section-spaces` with `h2 Spaces`, `#new-space`, `ul#spaces`; `#section-agents`). `renderSpaces()` (`main.ts` ~L804) and `spaceButton()` (~L832) build rows: letter avatar `space-tile tile-N`, name, branch, state indicator (`ui/indicator.ts`, styles `.ind-<state>`), worktrees nested. No machine grouping, per-group `+` or chevron, or collapse state exists. `sidebar-model.ts` (pure, tested) has `tileIndex`, `groupAgents`, `sidebarSpaceOrder` (drives Cmd+1..9). Only `grove-next.sidebar-hidden` is stored in localStorage.
- The `+` handler (`newSpaceTab()` ~L909) calls `spaces.add {path: homeDir}` (home folder; no folder picker exists) then opens a shell.
- Via core RPC (so remote-capable if the RPC is carried): spaces, worktrees (root `~/.grove/worktrees`), diff and comments, notes, config, integrations, tabs, agent status. Via Tauri on the local machine: `env_info` (home dir, `$SHELL`; used by `shortFolder` and new-space), `notify` and `play_sound` (macOS notification plus `/usr/bin/afplay`), `raise_window`, `install_cli`, `start_holder`. Browser-side: `navigator.clipboard`, localStorage.
- Config lives under `<home>/config`, read via core RPC (`ConfigSnapshot`). No machine list exists; a new file would need a schema entry in `core/config/schema.ts` `FILES` or a separate file. The UI cannot read disk except through core RPC or a new Tauri command.

## Commands

- From `next/`: `npm test` (`vitest run`, `packages/**/*.test.ts`, 15 s timeout, happy-dom for UI tests), `npm run typecheck` (`tsc --noEmit`), `npm run dev` (`tauri dev`, needs Rust). One file: `npx vitest run packages/ui/sidebar-model.test.ts`. Core, holder and CLI tests use sockets and PTYs, so need a working node-pty. The root `grove.config.json` commands run the old Electron app at the repo root, not `next/`.

## Open questions
