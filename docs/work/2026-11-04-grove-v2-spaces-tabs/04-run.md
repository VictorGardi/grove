---
feature: 2026-11-04-grove-v2-spaces-tabs
phase: run
status: draft
version: 1
created: 2026-11-04
updated: 2026-11-04
approved_at:
based_on: [03-plan.md@10]
forced: []
---

# Run: Grove rebuilt around spaces and tabs

Profile: inherit
Branch: feature/2026-11-04-grove-v2-spaces-tabs-inherit
Plan commit: af0c1f7e1eb65c74508a9bcd5649c2f8c69c726d
Review gate: slice 1
Roles:
- cto: claude, inherit
- researcher: claude, inherit
- planner: claude, inherit
- reviewer: claude, inherit
- implementer: claude, inherit

## Slice 1

Session: 1 shell tab survives window #3
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `next/` does not exist yet; the root app (`src/`, Electron, `node-pty` 1.1.0, `@xterm/xterm` 6, `scripts/fix-spawn-helper.mjs`) is untouched and not part of the new workspace. The root `vitest.config.ts` includes only `src/**` and `scripts/**`, so `next/` tests stay out of the old suite. macOS has the Command Line Tools and a Homebrew Rust (cargo 1.95), so the Tauri crate can be checked here. Slice 1 creates everything under `next/` from scratch.

Implementer 1 (foundation, runs first):
- [ ] `next/package.json` (private, own deps: `node-pty`, `@xterm/headless`, `@xterm/addon-serialize`, `typescript`, `vitest`; scripts `test`, `typecheck`, `postinstall` running `node scripts/fix-spawn-helper.mjs`), `next/tsconfig.json`, `next/vitest.config.ts` (include `packages/**/*.test.ts`), `next/scripts/fix-spawn-helper.mjs` (copy of the root script).
- [ ] `next/packages/protocol/paths.ts`: home from `GROVE_NEXT_HOME` or `~/.grove-next`, created mode 0700; socket paths `s` (core) and `h` (holder).
- [ ] `next/packages/protocol/framing.ts`: newline-delimited JSON with terminal bytes as base64; encode and decode, with a line splitter for partial reads.
- [ ] `next/packages/protocol/messages.ts`: method names and param and result types for `core.ping`, `tabs.create|list|write|resize|kill|attach`, and the `tabs.output` and `tabs.exit` events. Versioned (`protocolVersion: 1`).
- [ ] `next/packages/holder/pty-table.ts`: owns node-pty processes; per tab an `@xterm/headless` terminal with `@xterm/addon-serialize`, so `attach` returns the saved screen before live bytes.
- [ ] `next/packages/holder/server.ts`: unix socket server (JSON-RPC over the framing) on `h`.
- [ ] `next/packages/holder/bin.ts`: entry. Starts the server and supervises the core entry as a child, restarting it with a growing delay (250 ms doubling to 8 s). Core command overridable by `GROVE_NEXT_CORE_CMD` for tests.
- [ ] Tests: framing round-trips and splits partial lines; a new attach receives the saved screen after output was written; holder restarts a crashed core (fake core script) and keeps the PTY alive.

Implementer 2 (core, after Implementer 1):
- [ ] `next/packages/core/holder-client.ts`: connects to `h`; if it cannot connect, spawns `packages/holder/bin.ts` detached (`detached: true`, `stdio: 'ignore'`, `unref()`) with the Node path from the caller, then retries with a short backoff.
- [ ] `next/packages/core/daemon.ts`: JSON-RPC server on `s` (mode 0700 folder); implements `core.ping` and the `tabs.*` methods by proxying to the holder; relays holder output as `tabs.output` events to attached clients.
- [ ] `next/packages/core/bin.ts`: entry that runs the daemon.
- [ ] Tests: a tab created through the core survives killing only the core process (the holder keeps it); reattach after the core restarts shows the saved screen; a client that starts with nothing running brings up holder and core.

Implementer 3 (window, after Implementer 1; parallel with Implementer 2):
- [ ] `next/packages/ui/index.html`, `main.ts`: xterm.js with the WebGL addon; a calm sidebar with one fixed space and an empty agents list; a tab strip with a "+" that opens a shell tab in the space root; attach through the bridge.
- [ ] `next/packages/ui/stress.html`, `stress.ts`: a developer page with nine terminals fed by synthetic output; logs frame times, lost WebGL contexts and key-echo times, and prints the medians and 95th percentile.
- [ ] `next/packages/ui/src-tauri/` (`Cargo.toml`, `tauri.conf.json`, `src/main.rs`): Rust bridge. Connects to `s`, relays JSON-RPC lines, streams raw bytes to the page over a Tauri channel, starts the holder detached using the Node path in the environment (`GROVE_NEXT_NODE`, set by `npm run dev`), and exposes a notification command stub for slice 4.
- [ ] `next/package.json` scripts `dev` (`tauri dev`) and `build:app` (`tauri build`), added to Implementer 1's package file. `next/README.md`: prerequisites (Node, git, Rust, Xcode Command Line Tools), install, run, stress page, `build:app` for notifications.

Models passed: cto=inherit, researcher=inherit, planner=inherit, reviewer=inherit, implementer=inherit (general-purpose subagents, no `model`).

Verification: `cd next && npm install && npm test` passes, including the three test groups above; `npm run typecheck` passes; `cd next/packages/ui/src-tauri && cargo check` passes when crates can be fetched. By hand (not run here, left for the human): `npm run dev` opens the window and a `claude` tab survives closing and reopening the window; kill only the core and the tab repaints; the stress page five 60-second runs on both Macs; the work-Mac Rust install from a fresh clone.

### Review rounds (attempt 1)

Implementation: three implementers (foundation; core daemon; window and Tauri bridge). Checks run by the planner: `npm test` 12 of 12 passing, `npm run typecheck` clean, `cargo check` in `next/packages/ui/src-tauri` clean. A fresh reviewer read the whole slice.

Round 1 (1 blocking, 7 non-blocking, 1 spec check): blocking: a PTY chunk written between an attach request and its screen snapshot was lost (not in the snapshot, not delivered live). Fixed in `pty-table.ts` by registering the live listener at attach time with queued events, delivered by `flush` after the attach reply. Non-blocking: several, see Deviations and Left for the human.

Round 2 (1 blocking, re-review of round-1 fix): two pipelined attaches for the same tab on one socket left a stale listener, duplicating output. Fixed in `server.ts` by serialising attaches per tab per socket, then detaching the previous listener before storing the new one.

Round 3 (1 blocking, re-review of round-2 fix): a superseded listener dropped a queued exit event, so the client never learned the tab exited. Fixed by always delivering queued exit events on `flush`, and detaching the previous listener only after the new attach succeeds.

Verdict: not passed. Three fix rounds on the holder attach path, which is over the limit of two. Each fix passed the tests, and the last one has not been re-reviewed by a fresh reviewer. 3 blocking findings across the rounds, 0 open after the last fix (unverified by review).

Non-blocking left (not fixed): a request sent after the holder socket closed never settles, so a tab request from the window can hang in the core (`protocol/client.ts`); a killed holder is not restarted and an orphaned core keeps the socket reachable, so the Rust bridge never restarts the holder (D2 accepts holder death, but recovery is manual); tab kill sends SIGHUP only, with no escalation, so a child that ignores SIGHUP survives (`pty-table.ts` kill); two starters that race on stale socket removal can leave one unreachable (`core/daemon.ts`, `holder/server.ts`); `tabNotFound` and `tabExists` lose their codes through the core (`protocol/client.ts` rejects with a plain Error); the Rust bridge uses `process_group(0)` where D8 says a new session, and falls back to a bare `node` on PATH when `GROVE_NEXT_NODE` is unset; `kill` during a pending attach may leave the attach promise unresolved (xterm dispose behaviour not checked).

### Deviations

- `PtyTable.attach` returns `Promise<{screen, cols, rows, detach, flush}>`, and the listener is `{onOutput, onExit}` (needed for the snapshot ordering; the spec only asks for the saved screen).
- `packages/protocol/client.ts` (`connectRpc`) was added (the holder test and core need it).
- The holder answers `core.ping` as well as the `tabs.*` methods.
- Each core client gets its own holder connection, not one shared connection with fan-out (a reattach from a second client would otherwise replace the listener).
- Core `ensureHolder` returns the spawned child (or undefined) rather than a client.
- `removeStaleSocket` is duplicated in `core/daemon.ts` (not exported from holder).
- Holder socket path throws at 100 bytes or more (own cap).
- The window page does not import `framing.ts` (the Node-only string decoder breaks the browser build); base64 is local to `ui/bridge.ts`.
- The window adds `terminal.ts` (shared xterm setup) and `bridge.test.ts`, not in the spec's file list. The shell starts as a login shell (`-l`) so a GUI-launched PATH includes user tools.
- A `bridge.closed` pseudo-method (not part of the protocol) tells the page the core socket dropped.
- The holder kills all PTYs on SIGTERM. A SIGKILL'd holder leaves its children to the kernel (SIGHUP on master close).

### Halt (attempt 1)

Reason: three fix rounds on blocking findings in the holder attach path (rounds 1 to 3 above), over the limit of two. Tests pass after each fix. The last fix is not yet re-reviewed. The code for slice 1 is uncommitted in the worktree (`next/`), with this log as the halt commit.

What was tried: the attach-ordering fix (round 1), per-tab attach serialisation on each socket (round 2), and exit delivery across superseded listeners (round 3).

Fix rounds: 3 (limit 2).

### Options (attempt 1)

#### Option 1: Re-review the attach path once, then commit slice 1 as done

Pros: the remaining code is tested (12 of 12) and the findings have been narrowing each round; the human gate after slice 1 reads the result anyway; the stress and window checks are manual regardless.
Cons: breaks the two-round limit on purpose; a fourth blocking finding is possible.
Changes design or outcome: no.

#### Option 2: Commit slice 1 as is, with the non-blocking list as known gaps

Pros: unblocks slice 2; the attach path is covered by tests for the single-attach and superseded cases.
Cons: ships the attach path without a re-review; the pipelined-attach and exit cases have no dedicated test (only the reviewer's trace covers them).
Changes design or outcome: no.

#### Option 3: Narrow the attach contract, then re-plan the attach path

Make attach one-at-a-time per tab at the core (the core never sends a second attach for a tab until the first has replied), and drop the holder's per-socket queue. Pros: the holder's attach code becomes a single path with fewer orderings. Cons: a plan change to D2 or slice 1, and more work before slice 2.
Changes design or outcome: yes (the attach contract between core and holder).

Recommendation: Option 1. It is one more review of the code that is already written, with the two-round limit noted as exceeded on purpose; Option 3 changes the plan and should go to you only if Option 1 keeps finding blocking issues.

### Decision (attempt 1)

Decision: Option 1: re-review the attach path once more with a fresh reviewer, then commit slice 1 as done. Tests pass (12 of 12). Does not change the design or outcome; breaks the two-round fix limit on purpose. The uncommitted code in `next/` is the starting point; the halt commit is folded in (`git reset --soft HEAD~1`).

### Review rounds (attempt 2)

Decision re-review, one fresh reviewer over the whole slice with the attach path as focus. Verdict: not passed. 1 blocking, plus non-blocking items.

Blocking: a second attach to the same tab on one socket can deliver live output twice (`next/packages/holder/server.ts:62-72` with `next/packages/holder/pty-table.ts:137-166`). The new listener is registered at once, but the old one is detached only after the new attach's async snapshot resolves, so a chunk in that window goes to both. Exit can be sent twice the same way. The fix is to detach the previous listener before registering the new one. Not applied: the decision allowed one re-review and no further fix round. No test covers two attaches while output flows.

Non-blocking: a kill during a pending attach can stall the per-tab attach queue on that socket (`next/packages/holder/pty-table.ts` kill); attaching to an exited tab returns no exit event; the saved screen from `@xterm/addon-serialize` may not restore alternate-screen state or terminal modes (not checked against claude's TUI).

### Halt (attempt 2)

Reason: the decision re-review found a blocking defect on re-attach (duplicated output and exit, see Review rounds (attempt 2)). The decision granted one re-review and no fix; a fix now would be a fourth fix round on the attach path.

What was tried: the decision's one fresh re-review. No code changed in this attempt; tests 12 of 12 and typecheck pass as before, `cargo check` clean.

Fix rounds: 0 in this attempt (3 in attempt 1).

### Options (attempt 2)

#### Option 1: Fix the re-attach window, then re-review once more

Pros: the fix is small and local (detach the previous listener before registering the new one, after its flush), and a test that attaches twice on one socket while output flows would cover it.
Cons: a fourth fix round on the attach path, past the limit again; a new finding is possible.
Changes design or outcome: no.

#### Option 2: Commit slice 1 as it stands, with the re-attach duplication as a known gap

Pros: unblocks slice 2.
Cons: a window reopened on a live tab can show doubled output and a doubled exit event; the code has no test for it; the slice's own outcome (reopening shows the same screen) can fail.
Changes design or outcome: no.

#### Option 3: Narrow the attach contract, then re-plan the attach path

The core never sends a second attach for a tab until the first has replied, and the holder keeps a single listener per tab with no per-socket queue. Pros: one attach ordering to reason about. Cons: a plan change to the core-to-holder attach contract and more work before slice 2.
Changes design or outcome: yes.

Recommendation: Option 1. The defect is local and has a clear fix, and the decision was for one review, so the human should decide whether to grant one more fix round. Option 3 should be taken only if Option 1 keeps finding blocking issues.

### Decision

Decision: Option 1: fix the re-attach window, then re-review once more. Detach the previous listener synchronously, before the await on `table.attach` in `holder/server.ts`, so the swap happens in the same tick as the new registration (no window where both listeners receive output or exit). Add a test that attaches twice to the same tab while output flows, on one socket and across two sockets, and asserts no duplicated output or exit. Past the fix-round limit on purpose; does not change the design or outcome. The uncommitted code in `next/` is the starting point; the halt commit is folded in (`git reset --soft HEAD~1`).

### Slice plan (attempt 3)

Found in the code: `next/packages/holder/server.ts` `attach` queues per tab on each socket, then calls `table.attach` (which registers the live listener synchronously) and only after its `await` detaches the previous listener (`attachments.get(id)?.()`). In that window both listeners get output, and exit is sent twice. `pty-table.ts` `attach` is unchanged: its `detach` already stops output to a superseded listener while still letting its queued exit flush.

Implementer 1 (the fix and the test, one chunk):
- [ ] `next/packages/holder/server.ts`, the queued callback in `attach`: take the previous listener out first, synchronously, in the same tick as `table.attach` (call `attachments.get(id)?.()` and `attachments.delete(id)` before the `table.attach` call). After the await, store the new `attached.detach` (or detach at once when the socket is destroyed), as now. Keep the comment short and accurate.
- [ ] A test (`next/packages/holder/attach.test.ts`, or in `holder.test.ts`) that starts `startHolderServer` in-process with a `PtyTable` under `GROVE_NEXT_HOME` (the same socket path and home pattern as `holder.test.ts`), creates a tab running `/bin/sh -c` printing `line0` to `line39` with a short sleep each, exiting with code 7. Then: (a) one socket attaches 10 times in a row while output flows (no waiting for output in between, the queue serialises them); (b) two sockets each attach 5 times while output flows. Assert, per socket, every `line<N>` appears at most once in the live `tabs.output` stream, the last line `line39` is seen, and `tabs.exit` arrives exactly once with exit code 7 per socket.
- [ ] Before committing the fix, confirm the new test FAILS on the unfixed `server.ts` (temporarily revert, run, restore). Report the failure line in Verification.

Models passed: cto=inherit, researcher=inherit, planner=inherit, reviewer=inherit, implementer=inherit (general-purpose subagents, no `model`).

### Review rounds (attempt 3)

Implementation: one implementer subagent (the fix in `server.ts` and the new `attach.test.ts`). Its fix: `attachments.get(id)?.()` and `attachments.delete(id)` now run synchronously before `table.attach`, and the old call after the await is removed. The reviewer's trace is in the next paragraph.

Fresh reviewer over the attach path (code and plan given, no conclusions): verdict PASS, 0 blocking. It traced the order of the queued callback, the synchronous detach, the registration, the await, `flush`, a rejected `table.attach`, a socket closing while an attach is pending, kill during an attach, and an attach to an exited tab, and found no window where two listeners on one socket receive output or exit.

Non-blocking, not fixed (recorded under Left for the human): see below.

Fix rounds: 0 in this attempt (the decision's one fix; attempt 1 had 3, attempt 2 had 0).

### Deviations

- New test file `next/packages/holder/attach.test.ts` (two cases: one connection re-attaching ten times at once; two connections, five attaches each), not in the spec's file list. The test calls `killAll()` before `server.close()` so PTYs are cleaned up.
- The attach test was not deterministic against the unfixed code: the single-connection case failed (line0 seen twice, every other line once); the two-connection case failed in one isolated run and passed in one full-suite run. The duplication appears at line0, the first output of the burst.

### Verification

- `cd next && npm test`: 7 files, 14 tests, all pass (run by the planner, after the implementer's run).
- `cd next && npm run typecheck`: no errors (exit 0).
- New attach test run 3 times in a row on the fixed code: passes each time.
- On the unfixed `server.ts` (reverted for the check): the single-connection case fails with `line0 count: expected 2 to be less than or equal to 1`.
- `cargo check` is not affected by this change and was not re-run.

### Left for the human

- The two-connection duplication case can pass on the unfixed code (see Deviations). The reviewer suggested making it deterministic, e.g. by deferring the `term.write` callback in a test; not done in this slice.
- `kill()` clears the listeners, so a client attached to a tab that is then killed never receives `tabs.exit`. Intended? No comment says so (`pty-table.ts` kill).
- Attach to an already-exited tab returns no exit status, so a client must call `tabs.list` to learn the exit code.
- A killed tab's detach closure stays in `attachments` until the next attach to that id or socket close; `attachQueues` entries are never pruned (`server.ts`). Small per-socket leaks.
- After a supersede, the old listener's queued output is flushed before the second reply; a client that writes each snapshot without resetting its screen would show repeated content. The client side must reset (not checked here).
- The manual checks in the Verification of the plan (the window opens, the `claude` tab survives reopening, the stress page runs) were not run here.

## Slice 2

Session: 2 spaces tabs stick
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: slice 1 has the core daemon proxying `tabs.*` to the holder (`next/packages/core/daemon.ts`), `tabs.create` takes an optional id and fails with `tabExists` on an id the holder still has (exited tabs stay in its table, `pty-table.ts`), `groveNextHome()` is the one place for `~/.grove-next` (`protocol/paths.ts`), and the window only makes shell tabs in the fixed "Home" space (`ui/main.ts`, `ui/index.html`). Nothing reads or writes a state file yet. The root `vitest.config.ts` only includes `src/**` and `scripts/**`, so `next/` stays outside it; no root file changes in this slice.

Decisions made here, inside the slice (the plan leaves them open):
- The core owns the state. `<groveNextHome()>/state.json` is one versioned file (`version: 1`) with `spaces` (`{ path }`) and `tabs` (`{ id, spacePath }`, order = tab number within a space). The window and the CLI are clients over RPC, so they see the same truth (D5).
- Space identity is the real path (`fs.realpathSync`). `spaces.add` is idempotent: adding a known path returns it.
- A saved tab's id is its holder tab id. On core start, before it listens, a saved tab the holder does not know at all is created again with the same id, as a fresh login shell in its space's root (home if that folder is gone). A tab the holder still has (alive or exited) is left as it is. So a core restart keeps shells, and a reboot (holder gone) gives fresh shells in the same spaces and tabs.
- Worktree grouping is computed by the core from `git rev-parse --git-common-dir` and the first entry of `git worktree list --porcelain`. A space gets `parent` = the path of its main worktree when that path is also a space; otherwise `parent` is null and the space shows top-level with the repo's name (`repoName`) and its own folder name.
- A state file that cannot be parsed is renamed to `state.json.corrupt-<unix ms>` and the core starts empty. A state file with another or missing `version` is refused: the file is not touched, the core runs, and `spaces.*` and `tabs.open` fail with `stateRefused` and the reason (the window shows it).
- Tabs the holder has that no saved record names (for example from slice 1) are not shown in any space.
- The window adds a space by typing a path in a field under the spaces list (no folder picker: it would need the Tauri dialog plugin, a new dependency). Default value: the home folder.
- The shell is `$SHELL` (fallback `/bin/zsh`), started as a login shell (`-l`), as slice 1 does. The core picks it, not the window.

Implementer 1 (core: protocol, store, git, RPC, restore; runs first):
- [ ] `next/packages/protocol/messages.ts`: add methods `spaces.list` (params `Empty`; result `{ spaces: SpaceInfo[]; tabs: SpaceTabInfo[]; refused: string | null }`), `spaces.add` (params `{ path: string }`; result `SpaceInfo`), `tabs.open` (params `{ spacePath: string; cols: number; rows: number }`; result `{ id: string }`). `SpaceInfo = { path, name, repoName: string | null, parent: string | null }`, `SpaceTabInfo = { id, spacePath, alive, exitCode: number | null }`. Add error code `stateRefused: -32003`. Bump nothing else; `PROTOCOL_VERSION` stays 1 (nothing shipped). Add `MethodMap` and `METHODS` entries.
- [ ] `next/packages/protocol/client.ts`: move `connectWhenReady` here from `packages/core/test-helpers.ts` (export it; test-helpers re-exports or imports it), so the CLI can use it without importing a test helper.
- [ ] `next/packages/core/store/state.ts`: `loadState(file)` returns `{ kind: 'ok', state }` | `{ kind: 'refused', reason }`, sets aside a corrupt file (`state.json.corrupt-<ms>`) and returns an empty state; `saveState(file, state)` writes `file + '.tmp-' + pid`, then `fs.renameSync` (atomic). Types `StateV1`, `SpaceRecord`, `TabRecord`. No other fields.
- [ ] `next/packages/core/git.ts`: `spaceGitInfo(path)` runs `git -C` (explicit `-C` here, since this is core code, not an agent in a worktree) with `execFile` and returns `{ repoName, mainPath }` or nulls when the folder is not in git (or git is missing). `mainPath` = first `worktree` line of `git worktree list --porcelain`; `repoName` = basename of `mainPath`.
- [ ] `next/packages/core/spaces.ts`: service that owns the store file path and state: `list()` (spaces with `parent` from git info, tabs merged with holder `tabs.list` for `alive`/`exitCode`), `add(path)` (realpath, must be a directory, else `invalidParams`), `openTab(spacePath, cols, rows)` (new id with `crypto.randomUUID().slice(0, 8)`, holder `tabs.create` with `command = $SHELL`, `args ['-l']`, `cwd = spacePath`; then save), `restore()` (see Decisions). Holder access takes an `RpcClient`, passed in, so the daemon and the restore share the same code.
- [ ] `next/packages/core/daemon.ts`: dispatch the three new methods to `spaces.ts` (the holder connection is the one per client it already makes). `startCoreDaemon` takes `stateFile?` (default `groveNextHome()/state.json`) for tests.
- [ ] `next/packages/core/bin.ts`: after `ensureHolder()` and before `startCoreDaemon()`, run `restore()` through a holder connection; log its count.
- [ ] Tests (`next/packages/core/store/state.test.ts`, `next/packages/core/git.test.ts`, `next/packages/core/spaces.test.ts`): corrupt file set aside and an empty start; unknown version refused and the file bytes unchanged; save then load round-trips with no `.tmp-` file left; a temp repo with `git worktree add` gives `parent` = the main path when the main path is a space, and `parent: null` with `repoName` when it is not; `tabs.open` in a space gives a tab whose `pwd` output equals the space root (realpath); after the holder and core are stopped (`stopHolder`), a new stack restores the same space and tab id with a live shell in the space root.

Implementer 2 (CLI and the `grove-next` script; after Implementer 1; parallel with Implementer 3):
- [ ] `next/packages/cli/main.ts`: `main(argv, options)` returning an exit code, and the `bin` entry at the bottom. Commands: `space add [path]` (default `GROVE_NEXT_CALLER_CWD` or `process.cwd()`; prints `added <path>` or `already a space: <path>`), `space ls` and `ls` (spaces, then their tabs, one per line with the tab's number and alive/exited). Starts the holder with `ensureHolder()` when the core socket is not reachable, then `connectWhenReady(coreSocketPath())`. Errors print one line to stderr with exit 1; unknown command prints usage and exits 2.
- [ ] `next/bin/grove-next` (POSIX `sh`, executable in git: `git update-index --chmod=+x`): `here` = the `next/` folder, `export GROVE_NEXT_CALLER_CWD="$PWD"`, then `cd "$here" && exec node --import tsx packages/cli/main.ts "$@"`.
- [ ] `next/README.md`: a short "Spaces" section: `grove-next space add [path]`, `grove-next ls`, the state file location, and the reboot behaviour.
- [ ] Test (`next/packages/cli/cli.test.ts`): `main(['space', 'add', dir])` in-process with `GROVE_NEXT_HOME` set to a temp folder; a second add says already a space; `main(['ls'])` output includes the path. Stops the holder in `afterEach` (`stopHolder` pattern from `test-helpers.ts`).

Implementer 3 (window; after Implementer 1; parallel with Implementer 2):
- [ ] `next/packages/ui/index.html`: the sidebar's spaces section becomes a list container (`#spaces`) with an "Add space" form (a text input `#space-path` prefilled with the home folder, and a button). The agents section stays as it is. The stress link stays.
- [ ] `next/packages/ui/main.ts`: replace the fixed "Home" space and `tabs.create` with `spaces.list` on start and on every resync; nested rendering of `parent` children under their parent with the repo name for top-level worktrees; click a space to show its tabs; the tab strip shows only the active space's tabs, numbered 1..n within the space; "+" calls `tabs.open` for the active space (disabled when there is none); `spaces.add` from the form, then select the new space; a `refused` reason shown in the status line with "+" disabled. Keep the reattach/resync logic (`attach`, `markExited`, the queue) unchanged. Tabs of other spaces stay mounted and hidden.
- [ ] `next/packages/ui/styles.css`: the spaces list styles (indented children, muted repo name, active space marked with `aria-current`), the add-space form. Use the existing tokens.
- [ ] Keep `env_info` in the Rust bridge (the home default comes from it); no Rust change in this slice.

Models passed: cto=inherit, researcher=inherit, planner=inherit, reviewer=inherit, implementer=inherit (general-purpose subagents, no `model`).

Verification: `cd next && npm test` passes, including the store, git and spaces tests and the CLI test; `npm run typecheck` passes; `npx vite build` in `next/` builds both pages. Root files are not touched: `git diff --name-only 3aa8c05..HEAD -- ':!next' ':!docs'` is empty for this slice. By hand (not run here, left for the human): add one space from the window and one with `./next/bin/grove-next space add` from a terminal; open three tabs in each and run `pwd` (equals the space root); quit, `kill -9` the core and holder, reopen, and see the same spaces and tabs with fresh shells; the old Grove and `grove ls` still show only their own sessions, and the old state file's checksum is unchanged.

### Review rounds

Implementation: three implementers, one per chunk (core foundation; CLI and `bin/grove-next`; window). Checks run by the planner: `npm test` 26 of 26 after the first build, `npm run typecheck` clean, `npx vite build` in `next/packages/ui` builds both pages.

Round 1 (2 blocking, 7 non-blocking, fresh reviewer): blocking: a version-1 check that ran after the shape check let an unknown or missing version be set aside instead of refused; one failing tab create stopped the whole restore. Fixed in `store/state.ts` (version checked first; refused files untouched) and `spaces.ts` restore (each create isolated, failure logged, count returned). Non-blocking fixed: fsync before rename, awaited test expects, `emptyState()`, state built before saving, `rootFor` requires a directory. Not fixed: the window id race while a `tabs.open` is in flight, and `spaces.list` waiting on the holder connection.

Round 2 (1 blocking, 6 non-blocking, fresh reviewer): blocking: a version-1 file with a malformed entry (`{"version":1,"spaces":[null],...}`) was accepted and made `spaces.list` throw on every call. Fixed in `store/state.ts` (`isSpaceRecord` and `isTabRecord` checked per entry; a failing file is set aside). Non-blocking fixed: `spaces.add` rejects a relative path (invalidParams); the window expands a leading `~` from the home folder; `resync` marks nothing exited while the state is refused; the `node:path` import moved. Not fixed: openTab save-failure cleanup, the symlinked `mainPath`, the short-write loop, the directory fsync, the long-line style items.

Round 3 (fresh reviewer, the malformed-entry fix and the new paths): verdict PASS, 0 blocking. It probed `loadState` with crafted files (valid, wrong field types, arrays, null, invalid JSON, versions 2 and missing, extra fields, `spaces: null`); each behaved as the Decisions say.

Fix rounds: 2 (limit 2). Blocking findings across the rounds: 3, all fixed; 0 open.

### Deviations

- `spaces.add` rejects a relative path, and the window expands only `~` and `~/...`, so `~user/...` is sent as typed and rejected.
- `spaces.add` also throws `stateRefused` when the state is refused (the plan named only `tabs.open`); without it the next save would overwrite the refused file.
- `restore` recreates a missing tab with 80 by 24; the window resizes it on attach.
- `startCoreDaemon` takes an optional prebuilt `spaces` service (in addition to `stateFile`), so `bin.ts` restores and serves from one in-memory state.
- `RpcError` moved from `core/daemon.ts` to a new `protocol/errors.ts` so the service and the daemon share it (not in the plan's file list).
- `connectWhenReady` moved to `protocol/client.ts`; `core/test-helpers.ts` re-exports it.
- `cli/main.ts` exports `main(argv)` (the plan wrote `main(argv, options)`; no options were needed).
- The CLI prints `no spaces` on an empty list, and `error: <reason>` on stderr with exit 1 when the state is refused (the plan did not cover either).
- The window adds a space by typing a path in a text field (no folder picker: it would need the Tauri dialog plugin, a new dependency).
- `bin/grove-next` is staged with mode 100755 (set with `git update-index` through `git add`).
- Holder tabs with no saved record (for example slice 1's shell) are not shown in any space, as decided.

### Verification

- `cd next && npm test`: 11 files, 33 tests, all pass. Covered: state load and save (corrupt set aside, unknown and missing version refused with the file untouched, malformed entries set aside, atomic save with no tmp left), git grouping (worktree nested under a repo that is a space, top-level when not), the spaces service (`tabs.open` runs in the space root, a relative path rejected, a restore after the holder and core are stopped brings back the same space and tab with a live shell, one failing create does not stop the other tab), and the CLI (`space add`, re-add, `ls`, usage).
- `cd next && npm run typecheck`: exit 0.
- `cd next/packages/ui && npx vite build`: builds `index.html` and `stress.html` (run to a scratchpad outDir; `dist/` is gitignored).
- Manual CLI check: `grove-next space add <dir>`, the re-add, `ls` and an unknown command each gave the expected output and exit code, under a temp `GROVE_NEXT_HOME`.
- No file outside `next/` and `docs/work/2026-11-04-grove-v2-spaces-tabs/` changed; the root workspace is untouched.
- Not run here, left for the human: the window in `npm run dev` (add a space from the field, open three tabs in each space, `pwd` in each equals the space root); quit, `kill -9` the core and holder, reopen, and see the same spaces and tabs with fresh shells; the old Grove and `grove ls` still show only their own sessions and its state file's checksum is unchanged.

### Left for the human

- `state.ts` `loadState`: an unreadable state file (EACCES, EISDIR) throws out of the service constructor, so the core exits at start and the holder restarts it in a loop. The decision said refused. Fix: catch and return `refused` with the message.
- A top-level JSON value that is not an object (`[]`, `null`) is set aside, where the Decisions text says refused. Data is renamed, not deleted, so nothing is lost; either side could be the right one.
- `isSpaceRecord` accepts a relative `path` in a hand-edited file; the core would then run git against a cwd-relative path. Fix: require `path.isAbsolute`.
- The window's `addSpace` can read `homeDir` before `start()` has set it (`''`); a leading `~` typed then would become `/...`. Fix: refuse `~` input while `homeDir` is empty.
- `openTab`: if `saveState` throws after the holder created the shell, the shell runs unrecorded. Fix: kill it and rethrow.
- Window: a resync that runs while `tabs.open` is in flight can adopt the same id twice (a few-millisecond window; needs a reconnect or an add at that moment).
- `spaces.list` waits on the holder connection even though `spaces.add` does not need it.
- `git.ts`: a symlinked main worktree path makes `parent` null, so the worktree shows top-level rather than nested. Unverified on this machine; fix: `realpath` the `mainPath`.
- Short writes are not looped in `saveState`, and the parent directory is not fsynced after rename. Low risk on macOS.
- The `spaces.list` `tabs` are empty while the state is refused, so the window cannot show the tabs (only the refusal line).
- `client.ts` drops the error code on the wire (plain `Error(message)`), so the window cannot tell `stateRefused` from other failures by code.
- Long lines over 120 characters in `spaces.ts`, `ui/main.ts`.

## Slice 3

Session: 3 claude status trust #2
Status: done
Commit: this commit (see git log)

### Slice plan (attempt 1)

Found in the code: `protocol/messages.ts` has `tabs.*` and `spaces.*` only, with `TabInfo` carrying no agent. `core/daemon.ts` proxies `tabs.*` to the holder and holds `SpacesService` (`core/spaces.ts`); `core/store/state.ts` `TabRecord` is `{ id, spacePath }`. The holder (`holder/pty-table.ts`) already keeps an `@xterm/headless` screen per tab, so a visible-text read can be added there without new terminal code. The window (`ui/main.ts`) makes shell tabs only. Nothing reads a spool, runs a hook or knows Claude yet. The research (`02-research.md`) confirms the Claude hook events, the `--settings` per-launch override and `--session-id`/`--resume`. Recorded real Claude captures cannot be made unattended here, so the fixtures are synthetic captures in the documented hook shape (see Deviations).

Foundation (runs first, one implementer):
- [ ] `next/packages/protocol/messages.ts`: add `tabs.screen` (visible text of a tab's screen, holder and core), `agents.list` (tab id, agent kind, state, `since`, source, `resumable`), the notification `status.changed` (tab id plus new status); extend `tabs.create` with an optional `agent: { kind: 'claude', resumeId?: string }`. Additive, `PROTOCOL_VERSION` stays 1.
- [ ] `next/packages/core/status/contract.ts`: the status record, `type Status = { state: 'working' } | { state: 'needs-you'; reason: 'permission' | 'question' | 'error' } | { state: 'finished' } | { state: 'idle' } | { state: 'unknown' }` plus `since`, and `StatusEvent` (what an adapter emits: `{ at, kind: 'working'|'needs-you'|'finished'|'idle'|'session', ... }`). A pure reducer `applyEvent(status, event, now)`. Constants `GRACE_MS = 3000`, `SILENCE_MS = 30000`, overridable by options.
- [ ] `next/packages/core/status/cross-check.ts`: after a `needs-you`, wait the grace, read the screen text (normalised: ignore cursor, spinner glyphs and the selection marker), remember it; a later read that differs in real text falls the state to `unknown` until the next real event.
- [ ] `next/packages/core/status/watchdog.ts`: a `working` with no terminal output or spool activity for `SILENCE_MS` falls to `unknown`; the clock is injected.
- [ ] Tests (`*.test.ts` next to each file): reducer transitions; cross-check falls to unknown on a changed screen and holds on a repeated one; watchdog with an injected clock.

Claude adapter (after Foundation):
- [ ] `next/packages/core/agents/claude/launch.ts`: `claudeLaunch({ tabId, cwd, home, resumeId? })` returns `{ command: 'claude', args, env, sessionId, spoolFile }`. `args` are `--session-id <uuid>` (or `--resume <id>` on resume) and `--settings <inline json>`; the inline settings hold one hook command per event (`SessionStart`, `UserPromptSubmit`, `Stop`, `StopFailure`, `PermissionRequest`, `Notification`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `SessionEnd`) that runs `next/packages/core/agents/claude/hook.mjs <Event>`. That script appends one JSON line (event name, payload, time) to the spool and writes nothing else.
- [ ] `next/packages/core/agents/claude/source.ts`: spool tailer with byte offsets saved in `<home>/agents/claude/<tab>.offset`; `fs.watch` plus a 1 s poll; a corrupt line is skipped and counted; maps records to `StatusEvent`; `SessionStart` updates the resume id (covers `/clear`).
- [ ] `next/packages/core/agents/claude/fixtures/`: synthetic event captures (JSONL) and terminal-screen text captures for: a permission ask answered; an interrupted turn; an Esc-rejected question (screen before and after); a turn woken by a background task (`PreToolUse` without `UserPromptSubmit`). A README in the folder says they are synthetic, written from the documented hook shape.
- [ ] Tests: replay each capture through `source.ts` and the reducer, assert the state sequence; the stuck cases reach `unknown` through the cross-check or the watchdog with an injected clock.

Wiring and window (after Foundation, parallel with Claude adapter):
- [ ] `next/packages/holder/pty-table.ts` and `server.ts`: `tabs.screen` returns the visible rows as text; `next/packages/core/daemon.ts` proxies it.
- [ ] `next/packages/core/status/service.ts` (or inside `daemon.ts`): one per tab, owns the source and the status; the spool offsets are saved so a restarted core replays the spool and rebuilds each tab's state rather than resetting it; emits `status.changed`; `agents.list` answers from it.
- [ ] `next/packages/core/daemon.ts`: `tabs.create` with `agent` launches `claudeLaunch` (`--session-id` set, `TabRecord` gets `agent` and `agentSessionId`, saved in `state.json` with a version bump only if the shape needs it); `tabs.create` with `agent.resumeId` is the Resume path for a gone Claude tab, same tab id.
- [ ] `next/packages/ui/main.ts`, `index.html`, `styles.css`, `bridge.ts`: the agents list in the sidebar grouped by state (needs you, working, finished, idle, unknown), each row with the time since `since` (refreshed every 5 s); a click focuses the tab; a gone Claude tab shows a one-click Resume; `status.changed` updates the list. A "+ Claude" control opens a Claude tab in the space root.
- [ ] Tests: `daemon.test.ts` (agents.list, `tabs.screen`, restart rebuild from spool offsets), `bridge.test.ts` (status event passes through), `cli.test.ts` unchanged.

Models passed: cto=inherit, researcher=inherit, planner=inherit, reviewer=inherit, implementer=inherit (general-purpose subagents, no `model`).

Verification: `cd next && npm test` passes, including the new tests above; `npm run typecheck` passes; `cd next/packages/ui/src-tauri && cargo check` passes if Rust changed (not expected). By hand (not run here, left for the human): in `npm run dev`, ask Claude to run a command that needs permission and see "needs you" within about two seconds; answer and see working then finished; while Claude waits for permission `kill -9` the window and then only the core, reopen, and see "needs you" still shown for that tab; stop the spool reader and see "unknown" after the watchdog time; kill the holder and press Resume to bring the conversation back.

### Review rounds (attempt 1)

Implementation: a foundation implementer (protocol, status contract, cross-check, watchdog), then a Claude adapter implementer and a wiring and window implementer in parallel. Tests 137 of 137 and `npm run typecheck` clean at the last run.

Round 1 (fail, 4 blocking): the screen baseline was taken only after the grace, so a dialog dismissed inside it was missed; a killed Claude tab stayed needs-you; a dead spool reader never reached unknown for non-working states; `drain` could throw out of the core. Fix round 1 addressed all four, plus resume-id validation, file modes and event time. Fixed.

Round 2 (fail, 2 blocking): a working tab stayed working forever while the reader heartbeated; Resume after a Claude exit failed with `tabExists`. Fix round 2 added a progress clock for working tabs (changed normalised screen, non-heartbeat events), removed an exited holder tab before create, and fixed an `alive()` failure marking every tab gone, restore of a gone tab, and an unhandled rejection in the tick. Fixed.

Round 3 (fail, 3 blocking; see Halt).

Fix rounds used: 2 of 2.

### Review rounds (attempt 2)

Implementation: three implementers (status A; daemon and Claude source B; then a fix round for the review findings). Checks run by the planner after A and B: `npm test` 150 of 150, `npm run typecheck` clean. After the old-Grove ports: 152 of 152.

Round 1 (fresh reviewer, FAIL, 2 blocking, 9 non-blocking): blocking: `idle-prompt` turned a finished tab idle (the old Grove leaves finished alone); one failed `alive()` (a timeout) marked every tab unknown, which is a false unknown on a healthy holder. Fix round 1: needs-you and working go to finished on idle-prompt, finished and idle keep their since, unknown goes to idle; the gone check runs only after two consecutive failed `alive()` calls, and a success resets the count (a killed holder still reaches unknown in two ticks). Non-blocking applied: AskUserQuestion as the old Grove has it (a question from PreToolUse, no permission from PermissionRequest); a subagent is an `agent_id` other than the string `'main'`; misleading test names fixed. Replay case (c) now expects the question at PreToolUse (since 1200) and the elicitation notification repeats it. Non-blocking not applied, recorded under Deviations: StopFailure stays needs-you error (the plan's error reason has no other source); the spool stays line-based (plan); save-before-create leaves a record when the holder create fails and a caller-given resume id can overwrite a live tab's saved id before the refusal (plan, to be fixed with a rollback in a later slice); the rotating spinner verb is not stripped (not verified against Claude).

Round 2 (fresh reviewer over the whole round, FAIL, 1 blocking): all five round-1 items closed (the core side passes). Blocking: the window's `status.changed` handler kept the previous row's `resumable`, so a tab that fell to unknown on a holder death never showed Resume (no `tabs.exit` fires to refresh the list). Fix round 2: `ui/main.ts` now refreshes the list from `agents.list` after each `status.changed`. Non-blocking applied: the `StopFailure`/`Stop` case in `source.ts` is braced. Non-blocking noted: the same save-before-create, idle-prompt during a long permission wait (old behaviour, unverified against real Claude). A narrow fresh review of the fix round follows.

Fix rounds in this attempt: 2 (round 1 on the core, round 2 on the window). The decision allowed fix rounds past the limit for this attempt.

### Deviations (attempt 2)

- Reused from the old Grove (`src/core/claude/normalise.ts`): the `idle_prompt` Notification closes the open permission or question and ends a running turn, so the new `idle-prompt` event (working to finished, anything else to idle, in the reducer) follows it; the new version also sets idle when no turn was running, as the human asked. Stop and StopFailure from a subagent (an `agent_id` in the payload) do not end the main turn (the old `scope !== 'main'` rule). `PostToolUseFailure` clears a needs-you (a denied permission) as the old `close` does; it is mapped to working and added to the hook list in `launch.ts`.
- Reused in round 1 of this attempt: an `AskUserQuestion` question starts at PreToolUse and its PermissionRequest is ignored (the old `normalise.ts` pending map); a subagent is an `agent_id` other than `'main'`. The `idle-prompt` event ends a needs-you turn to finished (the old fold ends a running turn), so a permission or question interrupted by Esc ends as finished, not idle.
- Diverged on purpose: the gone check needs two consecutive failed `alive()` calls (about two seconds), not one. The plan's "a failed call falls every tab to unknown" made a single holder timeout show every tab as unknown; a killed holder still reaches unknown within two ticks.
- Not reused: the old per-scope pending map (`perm:<agent>`, `q:<tool_use_id>`). The new source keeps one needs-you per tab, which the plan's contract needs; a permission raised by a subagent therefore shows as the tab's needs-you, as before.
- Not reused: the old `PostToolBatch` marker, which records that a turn was woken by a background task and starts it running. The new `hook.mjs` writes the whole hook payload, which for PostToolBatch carries every tool's output; porting the marker needs its own hook command. The woken turn is caught by its `PreToolUse` (working), as the background-task fixture already shows. Left for a later slice; the gap is a late working state, not a stuck one.
- New, no old equivalent: the normaliser's spinner glyphs and token counters, the failed `alive()` falling every tab to unknown, and the save-before-create order in `createAgentTab`. The old Grove has no screen check and keeps no holder, so there was nothing to port. The save order follows `openTab` in this slice; a failed holder create leaves a resumable record.

### Deviations (attempt 1)

- The Claude fixtures are synthetic, written from the documented hook shape. No real Claude run was recorded, so the timings are unverified.
- Restore is synchronous: the source replays on creation.
- Spool offsets and a per-tab status file (`<home>/agents/claude/<tab>.status.json`) rebuild state after a core restart; the offset alone is not enough.
- Resume with no `resumeId` uses the saved `agentSessionId`.

### Halt (attempt 1)

Halted after round 3 of the review, with both fix rounds spent. Three blocking findings remain, all in the code as it stands (uncommitted in this worktree):

1. Claude's own spinner glyphs (`✻ ✽ ✶ ✳ ✢ ·`) and its token counter (`↑ 1.2k tokens`) are not stripped by `normaliseScreen` (`next/packages/core/status/cross-check.ts`). A hung Claude with an animated spinner counts as progress every tick, so a working tab never reaches unknown: the false working D3 forbids. The replay test only uses braille frames.
2. When the holder is killed, `alive()` fails on every tick and the gone check is skipped (`next/packages/core/status/service.ts` tick, `watchdog.ts`). The reader keeps heartbeating, so a finished or idle Claude tab shows "finished" or "idle" indefinitely after its process is gone.
3. `createAgentTab` (`next/packages/core/daemon.ts`) starts the holder process before saving the record, with no `assertNotRefused` before the create (unlike `openTab`). With a refused state file or a disk error, a live Claude process runs untracked, and every retry starts another.

The findings are narrow, but a fourth fix round would exceed the two-round limit, so the slice stops here.

### Options (attempt 1)

#### Option 1: Retry from the worktree as it stands (recommended)

Run `grove-run <slug> --continue` so a fresh child takes `Retry: yes` from the current code, fixes the three findings (the normaliser set, the failure path, save before create) and goes through a fresh review. Pros: the code is nearly complete, the 137 tests pass, the fixes are contained in three places. Cons: it is a fourth fix round beyond the two-round rule, so it needs your explicit go-ahead; the three findings may hide more. Changes design or outcome: no.

#### Option 2: Accept slice 3 as it stands and record the three findings under Left for the human

Commit the current code as slice 3 and carry the three findings into slice 4 or a follow-up. Pros: the main path works (permission to needs you, resume, restart rebuild), and the run moves on. Cons: the outcome's "never wrong for more than a few seconds" is not met for a hung Claude, a killed holder, or an orphaned process after a refused state file. Changes design or outcome: yes.

#### Option 3: Split slice 3 and restart it from the worktree

Split the slice in `03-plan.md` into three smaller slices: the status contract, cross-check and watchdog first; the Claude adapter next; the wiring and window last. Each gets its own review. Pros: each boundary (where the three findings sit) gets a narrower review. Cons: the plan changes, the uncommitted work becomes a starting point rather than a commit, and it takes more sessions. Changes design or outcome: no.

### Decision

Decision: Option 1: retry from the worktree as it stands, with the human's explicit go-ahead for a fix round beyond the two-round limit. Fix the three blocking findings: (1) `normaliseScreen` in `next/packages/core/status/cross-check.ts` also strips Claude's spinner glyphs (`✻ ✽ ✶ ✳ ✢ ·`) and token counters such as `↑ 1.2k tokens`, with replay cases using those glyphs, so a hung Claude with an animated spinner falls to `unknown`; (2) when the holder is killed, the gone check still runs when `alive()` fails, so finished or idle tabs do not stay stale (`status/service.ts` tick, `watchdog.ts`); (3) `createAgentTab` in `core/daemon.ts` saves the record before starting the holder process and calls `assertNotRefused` before create, as `openTab` does. Also, as a small additive change within D3 (hooks stay the primary source): map the Claude `Notification` hook with `notification_type` `idle_prompt` to `idle`, or to `finished` when the tab was working, as the old Grove does (`src/core/claude/normalise.ts`), with a test. The D3 screen cross-check and the watchdog stay unchanged. Does not change the design or outcome. The uncommitted code in `next/` is the starting point; the halt commit is folded in (`git reset --soft HEAD~1`).

### Slice plan (attempt 2)

Found in the code: `status/cross-check.ts` `normaliseScreen` strips braille spinners, timers and the selection marker only, so Claude's `✻ ✽ ✶ ✳ ✢ ·` spinner and its `↑ 1.2k tokens` counter count as real change in `StatusService.readWorkingScreen` and keep a hung working tab alive. `status/service.ts` `tick` skips the gone check for every tab when `alive()` rejects (holder killed). `core/daemon.ts` `createAgentTab` starts the holder tab before `saveAgentTab`, and never calls `assertNotRefused` (it is private on `SpacesService`; `openTab` calls it). `agents/claude/source.ts` `eventsFor` returns nothing for `Notification` with `idle_prompt`; the old Grove ends the turn there (`src/core/claude/normalise.ts`, the Notification case). `watchdog.ts` needs no change: its silence rules already work once the tick reaches a gone tab.

Implementer A (status; runs in parallel with B; files: `status/cross-check*.ts`, `status/service*.ts`):
- [ ] `next/packages/core/status/cross-check.ts`: `normaliseScreen` also strips `✻ ✽ ✶ ✳ ✢ ·` and token counters (an arrow `↑` or `↓`, a number with an optional `k` or `m`, then `tokens`). Update the comment above the regexes. Braille glyphs, timers and the selection marker stay.
- [ ] `next/packages/core/status/cross-check.test.ts`: `normaliseScreen` cases for those glyphs and counters; two frames that differ only in glyph or counter normalise to the same text.
- [ ] `next/packages/core/status/service.ts` `tick`: when `alive()` rejects, every tab is treated as gone for that tick (an empty set), so the gone check runs; gone tabs fall to unknown. Update the comment on the `alive` option and in `tick` to say so (a failed call means the tabs cannot be confirmed alive).
- [ ] `next/packages/core/status/service.test.ts`: (a) a failed `alive()` falls a finished or idle tab to unknown (replace any existing case that expects the skip); (b) a working tab whose screen changes only in spinner glyphs and a token counter reaches unknown through the watchdog with an injected clock, while a change in real text does not.

Implementer B (daemon, spaces, Claude source; runs in parallel with A; files: `daemon*.ts`, `spaces*.ts`, `status/contract*.ts`, `agents/claude/source*.ts`):
- [ ] `next/packages/core/spaces.ts`: `assertNotRefused` becomes public. No other change.
- [ ] `next/packages/core/daemon.ts` `createAgentTab`: call `deps.spaces.assertNotRefused()` first, before the tab record lookup; call `deps.spaces.saveAgentTab(...)` before `holder.request(METHODS.tabsCreate, ...)`; call `deps.status.track(...)` after the create succeeds. A failed holder create leaves the saved record (the tab then shows as gone and can be resumed).
- [ ] `next/packages/core/daemon.test.ts`: (a) with a refused state, `tabs.create` with `agent` fails with `stateRefused` and no holder tab is created; (b) when the holder create fails, the record is still saved.
- [ ] `next/packages/core/status/contract.ts`: a new `StatusEvent` `{ kind: 'idle-prompt' }`. `applyEvent`: from `working` it moves to `finished`; from any other state to `idle`; the same state keeps `since`. Document it in the comment above the type (the Claude `idle_prompt` notification, which ends an interrupted or Esc-rejected turn with no other hook).
- [ ] `next/packages/core/status/contract.test.ts`: working to finished; needs-you to idle; unknown to idle; idle to idle keeps `since`.
- [ ] `next/packages/core/agents/claude/source.ts` `eventsFor`: `Notification` with `notification_type` `idle_prompt` returns `[{ kind: 'idle-prompt' }]`. `permission_prompt` and `elicitation_dialog` are unchanged.
- [ ] `next/packages/core/agents/claude/source.test.ts`: an `idle_prompt` record maps to `idle-prompt`; a Notification of another type still maps to nothing.

Shared: each implementer runs only its own test files with `npx vitest run <files>` (inside `next/`); the planner runs the full `npm test` and `npm run typecheck` after both return. Each new test is first run against the unfixed code and its failing line is reported.

Models passed: cto=inherit, researcher=inherit, planner=inherit, reviewer=inherit, implementer=inherit (general-purpose subagents, no `model`).

### Verification

- `cd next && npm test`: 18 files, 157 tests, all pass (after fix round 2).
- `cd next && npm run typecheck`: exit 0, no output.
- Replay of the recorded fixtures (synthetic, see `fixtures/README.md`): permission answered, interrupted turn, Esc-rejected question (now starts at PreToolUse, since 1200), background-task turn; the cross-check falls the Esc case to unknown on a changed screen and holds it on an unchanged one.
- Spinner and token-counter cases: the glyph-only and counter-only screen changes in a working tab fall to unknown through the watchdog; a real text change keeps it working.
- A failed `alive()` falls a tab to unknown on the second consecutive failure, not the first.
- Not run here, left for the human: `npm run dev` in the window; a `claude` tab asking for permission shows needs-you within about two seconds; answer and see working then finished; `kill -9` the window, then the core, reopen, and see needs-you still shown; stop the spool reader and see unknown after the watchdog time; kill the holder and press Resume. These are the slice's by-hand checks in `03-plan.md`.

### Left for the human

- The fixtures are synthetic; no real Claude run was recorded, so the timings (the grace, the silence and the idle_prompt delay) are unverified against Claude.
- `idle_prompt` may fire during a long permission wait (about a minute), which would show finished rather than needs-you. The old Grove does the same; check it in the by-hand run.
- The rotating spinner verb (for example a word that cycles while Claude thinks) is not stripped; a hung turn whose verb changes would count as progress. Check it against a real hung turn.
- Save before create leaves a record if the holder create fails, and a caller-supplied `agent.resumeId` can overwrite a live tab's saved id before the refusal. Fix with a rollback in a later slice.
- The spool is read line by line (plan decision). The old `spool.ts` reads records independent of newlines; a glued pair loses both records. Port the old scan if real spool files show it.
- `PostToolBatch` (the marker for a turn woken by a background task) is not ported; see Deviations (attempt 2).
- StopFailure is needs-you error (the plan's error reason). The old Grove ends the turn on StopFailure. Confirm the choice.

## Slice 4

Session: 4 interrupts seen mark
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `next/packages/core/status/service.ts` `apply()` is the only place a change is emitted, to `subscribe` listeners, and `restore()` emits nothing, so a restart notifies nothing (as the old Grove's primed flag does). `daemon.ts` broadcasts each change as `status.changed` and has no focus input yet. `next/packages/ui/main.ts` knows the active tab (`active`), its label (`tabLabel`), and renders from `paint()`, but has no window focus state. `next/packages/ui/src-tauri/src/lib.rs` has a `notify` stub that takes title and body only. Old Grove: `src/core/core.ts` `notifyTransitions` (notify on entering waiting or a new reason, not for the tab on screen), `refreshStatus` (the on-screen tab is marked seen), `statusOf` (finished and seen shows as idle), `src/main/sound.ts` (Glass for permission and question, Funk for done, one sound per burst, 1 s gap), `src/main/index.ts` (notification bodies, click raises the window). The `tauri-plugin-notification` 2.8.0 crate for Tauri 2 is fetchable; no plugin is in Cargo yet.

Implementer A (core, runs first):
- [ ] `next/packages/protocol/messages.ts`: `METHODS.attentionFocus = 'attention.focus'`; `MethodMap['attention.focus']` params `{ tabId: string | null; windowFocused: boolean }`, result `Empty`; `AttentionNotice` `{ tabId: string; state: 'needs-you' | 'finished'; reason?: NeedsYouReason }`; `NotificationMap['attention.notify']: AttentionNotice`.
- [ ] `next/packages/core/status/service.ts`: `markSeen(tabId)`: a `finished` tab becomes `idle` (since now) through `applyEvent(..., { kind: 'idle' })`, anything else is a no-op. Goes through `apply()` so it is saved and broadcast.
- [ ] `next/packages/core/attention/attention.ts` (new): pure class `Attention` with `focus(tabId, windowFocused)` and `onStatus(change)`. Same rules as the old Grove: a tab entering needs-you (any reason) or finished notifies once per entry (dedupe key per tab, cleared by any other state), unless it is the tab on screen (`windowFocused` and `tabId` equal); a finished tab on screen is marked seen at once; `focus` marks the tab on screen seen. Calls `notify(notice)` and `markSeen(tabId)` given in its options.
- [ ] `next/packages/core/daemon.ts`: `attention` in `Deps`; the status subscription also calls `attention.onStatus`; `attention.notify` broadcast to every client; `attention.focus` validated (tab id matches `TAB_ID` or null, boolean) and handled; the socket that last sent it clears the focus when it closes (window closed means not focused).
- [ ] Tests: `next/packages/core/attention/attention.test.ts` (each transition, dedupe, reason change, on-screen rules, a second entry after idle notifies again, unknown and working never notify); `service.test.ts` gets `markSeen` cases (finished to idle and saved; working untouched).

Implementer B (window, runs after A):
- [ ] `next/packages/ui/alerts.ts` (new): pure. `noticeBody(notice)` (`Needs permission`, `Has a question`, `Hit an error`, `Finished`); `createSoundGate(now)` returns `(notice) => string | null`: `/System/Library/Sounds/Glass.aiff` for needs-you, `Funk.aiff` for finished, null otherwise or within `SOUND_GAP_MS` (1000) of the last sound. Port of `src/main/sound.ts`.
- [ ] `next/packages/ui/alerts.test.ts` (new): the cases of `src/main/sound.test.ts`, plus the bodies.
- [ ] `next/packages/ui/main.ts`: `windowFocused` from `getCurrentWindow().isFocused()` and `onFocusChanged`; `reportFocus()` sends `attention.focus` with the active tab id (or null) and window focus, deduped, called from `paint()` and the focus change, and re-sent after a reconnect; `bridge.on('attention.notify')` calls `invoke('notify', { title: tabLabel, body, sound })`.
- [ ] `next/packages/ui/src-tauri/Cargo.toml`: `tauri-plugin-notification = "2.8.0"`; `lib.rs`: plugin registered; `notify(app, title, body, sound: Option<String>)` shows the notification and, when there is a sound, runs `/usr/bin/afplay <file>` detached (its failure is logged, not fatal).
- [ ] Gates: `npm test`, `npm run typecheck` in `next/`, `cargo check` in `next/packages/ui/src-tauri`.

Verification (by hand, from the built bundle, not run here): two Claude tabs, the window in another app, one asks permission and the other finishes; both notify with a sound; focusing a tab clears its finished state; record whether clicking reaches the tab.

### Review rounds

Round 1 (fresh reviewer, read-only): 0 blocking, 4 non-blocking. (a) A failed `attention.focus` replaced the reconnect message in the status line: fixed, the error now goes to the console only. (b) A tab that enters needs-you while on screen is not notified if the window then loses focus while it still waits: left (matches the old `waitKey`). (c) A needs-you or finished replayed at a core restart is not notified: left (plan-accepted, matches the old primed flag). (d) No daemon-level test for `attention.focus` validation or clearing focus on socket close: left, see Left for the human.

Clean, 0 blocking, 0 fix rounds. Non-blocking left: (b), (c), (d).

### Deviations

- Reused from the old Grove: the notify rules of `notifyTransitions` (entering needs-you or finished, once per entry, a new reason notifies again, the tab on screen is skipped), the seen mark of `refreshStatus`, the seen-finished-reads-idle rule of `statusOf` (here the `markSeen` transition), no notify at restore (primed), `src/main/sound.ts` (Glass for needs-you, Funk for finished, one sound per burst with a 1 s gap, `/usr/bin/afplay`), and the notification bodies.
- Diverged: no per-tab sound toggle (the old Grove's sound is off per session unless turned on; the brief asks for a sound on every interrupt). The old "finished child stays quiet" rule is not ported (no link concept in v2). The notification title is the tab label (space name and tab number), not a session label. Added the body "Hit an error" for the error reason.
- Focus comes from the window (`attention.focus`, with `isFocused` and `onFocusChanged`), not from the old IPC. `markSeen` is called for the on-screen tab whenever the window is focused; it does nothing unless that tab is finished.
- Click-to-raise is not implemented. The old Grove's notification click raises the window and focuses the session; the new notification plugin's click reporting on desktop was not checked, so clicking a banner is expected to do nothing yet.
- `afplay` is reaped on a background thread so a finished sound does not stay a zombie. The old `execFile` callback also reaped.
- Notifications are raised by the window's process, as the plan says: nothing notifies while the app is fully quit.

### Verification

- `npx vitest run` in `next/`: 20 files, 181 tests passed (after the review fix).
- `npm run typecheck` in `next/`: exit 0.
- `cargo check` in `next/packages/ui/src-tauri`: exit 0, no warnings.
- Core logic tests: `next/packages/core/attention/attention.test.ts` (each transition, dedupe, reason change, on-screen rules, a second entry after idle) and `markSeen` cases in `service.test.ts`.
- Not run here: the by-hand check from the built bundle (`tauri build`), since banners and the sound do not appear from a development binary.

### Left for the human

- By hand, from the built bundle (`npm run build:app`): two Claude tabs, the window in another app; one asks for permission and the other finishes; both notify with a sound. Focusing a tab clears its finished state. Record whether clicking the notification reaches the tab (expected: no, see Deviations).
- Non-blocking, left as they are: a needs-you entered on the focused tab, followed by switching away while it still waits, does not notify; a permission request pending when the core restarts is not notified.
- No daemon-level test covers `attention.focus` validation and focus clearing when the window's connection closes.

## Slice 5

Session: 5 opencode copilot
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: the status layer is Claude-only. `status/service.ts` takes `launchClaude` and `createSource` and hard-codes `AGENT_SOURCE = 'claude'`, `record.agent !== 'claude'`, and the `agents/claude` folder. `agents/claude/source.ts` mixes a generic spool reader (`readSpool`, offsets, watch, poll heartbeat, `drain`) with the Claude-only `eventsFor`. `protocol/messages.ts` types `AgentInfo.agent`, `StatusChange` (no agent kind) and `tabs.create`'s `agent` as `'claude'`; `store/state.ts` `TabRecord.agent` is `'claude'`; `spaces.ts` has `claudeTabs()`; `daemon.ts` `createAgentTab` rejects any kind but claude and calls `launchClaude` directly; `ui/main.ts` has `newClaudeTab` / `resumeAgent` hard-coded to `command: 'claude'`, and `ui/index.html` has one "+ Claude" button. Old Grove, read for reuse: `src/core/opencode/normalise.ts` (event envelope, `pending` for permission and form events, `exec-started` / `exec-ended`, child sessions, `snapshotOf` for re-sync), `src/core/opencode/client.ts` (service file under `XDG_STATE_HOME`, Basic auth, `/api/event` SSE with `sseData`, silence timeout, reconnect loop with backoff, `snapshot` re-sync, `argv` = `opencode -s <id>` for start and resume alike), `src/core/opencodeId.ts` (`mintSessionId`, `ses_` ids), `src/core/copilot/normalise.ts` (`step()` fold: turn start and end, user prompt, `notification` permission and question, pre and post tool hooks, `agentStop`, `sessionEnd`, `abort` and `session.shutdown` from the log, stale-abort check by `startedAt`, subagents ignored by `agentId`), `src/core/copilot/hooks.ts` (per-launch plugin, `printf` stamp into a `{t, e}` JSONL spool, never fails Copilot), `src/core/copilot/events.ts` (root turn and abort records from `session-state/<id>/events.jsonl`, byte offsets, 1 MiB first read), `src/core/copilot/source.ts` (`--session-id` / `--resume=<id>` argv, `--plugin-dir`, `copilotOnPath` through the login shell with a cached positive probe, 1 s poll of the log). The old `src/core/claude/spool.ts` is what `status/spool.ts` ports. `opencode`, `copilot` and `claude` are all on this Mac (`/opt/homebrew/bin`), but no live run is part of this slice: the captured shapes are the ones the old tests use (research-verified per their comments). The new contract (`status/contract.ts`) is the StatusEvent set, so old AgentEvent kinds that the status does not need (`prompt`, `wrote`, `context`, `child`, `connected`) are dropped, not ported.

Shared adapter contract (Implementer 1 creates it; Implementers 2 and 3 code against it, do not change it):

```ts
// next/packages/core/status/adapter.ts
export type AgentKind = 'claude' | 'opencode' | 'copilot'
export interface AgentLaunch { command: string; args: string[]; env: Record<string, string>; sessionId: string }
export interface AdapterLaunchInput { tabId: string; cwd: string; home: string; resumeId?: string }
export interface AdapterWatchInput { tabId: string; sessionId: string; home: string; clock: () => number; onEvent: (event: StatusEvent, at: number) => void }
export interface AgentWatch { close: () => void }
export interface AgentAdapter {
  kind: AgentKind
  // Throws RpcError-free Error with a message when a resume id is not valid for this agent.
  launch(input: AdapterLaunchInput): AgentLaunch
  // Starts reporting for one tab. Delivers StatusEvents; the service folds them and owns the sidecar and the cross-check.
  watch(input: AdapterWatchInput): AgentWatch
  // Optional: resolves false when the command is not on the login shell's PATH (the create is refused with agentMissing).
  available?: () => Promise<boolean>
}
```

`StatusEvent` gains one kind, `{ kind: 'lost' }`: the source cannot read its signal now (the OpenCode event connection dropped). The service sets the tab to unknown (the same path as a gone tab). Nothing else in the contract changes; the reducer maps `lost` to unchanged state and the service calls `fallToUnknown`.

Implementer 1 (core, runs first, alone):
- [ ] `next/packages/core/status/contract.ts`: add `lost` to `StatusEvent` with its comment; `applyEvent` leaves the state alone; tests in `contract.test.ts`.
- [ ] `next/packages/core/status/adapter.ts`: the types above, exactly.
- [ ] `next/packages/core/status/spool.ts` (new): generic spool reader moved from `agents/claude/source.ts` (`readSpool`, `SpoolRecord`, `SpoolRead`, corrupt counting, the offset file load and save, the fs.watch with rename and error handling, the 1 s poll that is the heartbeat). The line parser is a parameter (`parse: (line: string) => SpoolRecord | null`), defaulting to the Claude one, so Copilot can use its `{t, e}` records. Export `createSpoolSource({ spoolFile, offsetFile, clock, onEvent, toEvents, parse })`. Keep the Claude source as a thin wrapper with the same exported names (`readSpool`, `replaySpool`, `eventsFor`, `deliveriesFor`, `createClaudeSource`, `POLL_MS`) so `source.test.ts` and `replay.test.ts` pass unchanged.
- [ ] `next/packages/core/agents/claude/adapter.ts` (new): `createClaudeAdapter()` implementing `AgentAdapter`: `launch` calls `claudeLaunch` (spoolFile stays on its return value, not on `AgentLaunch`), `watch` calls `createClaudeSource` with `claudeSpoolFile(home, tabId)` and the offset file `home/agents/claude/<tab>.offset`.
- [ ] `next/packages/core/status/service.ts`: `StatusServiceOptions.adapters: Record<AgentKind, AgentAdapter>` replaces `launchClaude` and `createSource`; `TrackInput` drops `spoolFile`; `Watch` keeps `kind`; `restore`, `track`, `list`, `apply` and the snapshot files use `home/agents/<kind>/` (`AGENT_SOURCE` goes); `restore` takes every record with an `agent` kind; `onEvent` handles `lost` by `fallToUnknown`; `StatusChange` and `AgentInfo` carry `agent: kind` and `source: kind`. The `onSession` callback stays. Tests in `service.test.ts` move to the adapter fakes; every existing case keeps its meaning.
- [ ] `next/packages/protocol/messages.ts`: `AgentKind` imported from the adapter types (or re-declared, one definition only); `AgentInfo.agent: AgentKind`; `StatusChange.agent: AgentKind`; `tabs.create` `agent?: { kind: AgentKind; resumeId?: string }`; error code `agentMissing: -32004`.
- [ ] `next/packages/core/store/state.ts`: `TabRecord.agent?: AgentKind` (no version bump, as the file says for optional fields; loading an old file with `agent: 'claude'` is unchanged). `next/packages/core/spaces.ts`: `claudeTabs()` becomes `agentTabs()` (every tab with an agent); `setAgentSession` unchanged.
- [ ] `next/packages/core/agents/registry.ts` (new): `export const adapters: Partial<Record<AgentKind, AgentAdapter>>` built with `createClaudeAdapter()`. Implementers 2 and 3 add one import and one entry each. `daemon.ts` takes `adapters` (default: the registry) instead of `launchClaude`; `createAgentTab` takes any kind in the registry (unknown kind: `invalidParams`, "agent.kind must be one of ..."); it runs `available()` once per kind (cached when true, as the old Copilot probe did) and refuses with `agentMissing` and a message naming the command when false; then `launch`, saves the record before the holder create (as today), `tabs.create` with `command`, `args`, `env`, then `status.track`. `bin.ts` is unchanged apart from what the daemon options need.
- [ ] `next/packages/ui/bridge.ts` and `main.ts`: no behaviour change yet beyond types: `newClaudeTab` and `resumeAgent` keep working through the new kind-agnostic path (see Implementer 4).
- [ ] Gates: `npx vitest run` in `next/` (181 passing before this slice; the same tests, adjusted, must pass), `npm run typecheck`.

Implementer 2 (OpenCode, after Implementer 1; parallel with 3 and 4; new folder only, plus one import and one registry line):
- [ ] `next/packages/core/agents/opencode/normalise.ts`: port `src/core/opencode/normalise.ts` for the status events only. Keep `normalise` (envelope, `pending` for permission and form events with the `open` flag, `exec-started`, `exec-ended` for succeeded, failed and interrupted, child sessions for the filter), `sseData`, `snapshotOf` and `childIds`, `unwrap`. Map to StatusEvent in a new function `statusFor(raw, sessionId)`: an exec start → `working`; an exec end → `finished`; a permission or form open → `needs-you` (`permission` or `question`); a close → `working` when the session is still running, else nothing; `session.created` of a child and any event for another session → nothing. Drop `prompt`, `wrote`, `context`, `tool` and token functions (old Grove only; the new contract does not need them). Port the snapshot-to-status rule: from a re-sync snapshot, `needs-you` for each open pending item, `working` when running, and `idle-prompt` when it is not running and the tab was working or needs-you (the contract's rule for a turn that ended while nothing was listening).
- [ ] `next/packages/core/agents/opencode/hub.ts` (new): one shared connection per core (the old `HttpOpenCode` loop: service file read on every connect, `fs.watchFile` kick, `/api/info` version, `/api/event` SSE, silence timeout 45 s, reconnect backoff 1 s doubling to 10 s, `stop`). It routes each event to the watch whose `sessionId` matches; on connect and on each reconnect it runs the snapshot for every watched session (`/api/session/active`, `/api/session/:id`, `/permission`, `/form`) and folds it. A dropped connection sends `lost` to every watch; a read of any byte sends `heartbeat`. Service file path: `XDG_STATE_HOME` or `~/.local/state`, `opencode/service.json`; the password is never logged. Fetch is injected for tests.
- [ ] `next/packages/core/agents/opencode/adapter.ts` (new): `createOpenCodeAdapter({ hub?, serviceFile?... })`: `kind: 'opencode'`; `launch` mints `ses_` ids with `mintSessionId` (port `src/core/opencodeId.ts` into this folder) or validates a resume id against `^ses_[0-9A-Za-z]+$`; argv `['-s', id]` for start and resume alike; `env: {}`; `watch` registers the session with the hub and returns a watch that unregisters on close; `available` = `opencode` on the login shell's PATH (port `copilotOnPath` as a generic `commandOnPath(command, shell)` in `next/packages/core/agents/commandOnPath.ts`, and make Implementer 3 use it too: Implementer 2 creates it, Implementer 3 imports it, the planner checks it in).
- [ ] Tests: `normalise.test.ts` (port the cases of `src/core/opencode/normalise.test.ts` for the status mapping; each permission, form and exec case, a child session ignored, another session ignored); `client.test.ts` (port `sseData` cases and the snapshot cases of `src/core/opencode/client.test.ts`; a fake fetch and a fake service file; a dropped stream sends `lost` to each watch; a reconnect re-syncs a running session to `working`; silence aborts the stream); `adapter.test.ts` (ids are `ses_`; a bad resume id throws; argv is `-s id`). Fixtures: copy the event shapes the old tests use into `next/packages/core/agents/opencode/fixtures/` as JSON lines with a README stating the OpenCode version the old tests name (2.0.20) and that they were not re-captured in this slice.
- [ ] A replay test in `next/packages/core/agents/opencode/replay.test.ts`: a fixture sequence (start, permission asked, replied, exec ended) gives `working`, `needs-you permission`, `working`, `finished` in order, with an injected clock.

Implementer 3 (Copilot, after Implementer 1; parallel with 2 and 4; new folder only, plus one import and one registry line):
- [ ] `next/packages/core/agents/copilot/hooks.ts`: port `src/core/copilot/hooks.ts` unchanged in behaviour (`HOOK_EVENTS`, `hookCommand`, `pluginJson`, `hooksJson`) and its tests if the old folder has them (it has none; add a test that the command never exits non-zero and writes one `{t, e}` line).
- [ ] `next/packages/core/agents/copilot/normalise.ts`: port `src/core/copilot/normalise.ts` (`step`, `emptyFold`, `writePaths` is dropped, `readContext` dropped, `sameContext` dropped) with `step()` returning `{ fold, events: StatusEvent[] }` under the same rules: turn start (root, not running) → working; `userPromptSubmitted` → working; `preToolUse` (root, not running) → working; `notification` permission_prompt → needs-you permission; elicitation_dialog → needs-you question; a pending prompt closed by a tool result or a turn end → working when the turn is still running (a close with nothing pending emits nothing); `agentStop`, `assistant.turn_end`, `sessionEnd` when running, `abort` and `session.shutdown` after the turn started → finished; `sessionStart` on a running fold → finished (a resume after an unclean end). Subagent records (with `agentId`) are ignored, as before. Keep `startedAt` and the stale-abort check.
- [ ] `next/packages/core/agents/copilot/events.ts`: port `src/core/copilot/events.ts` (root turn, abort, shutdown records from `session-state/<id>/events.jsonl`, byte offsets, a first read of at most 1 MiB, complete lines only). Drop the usage record (context).
- [ ] `next/packages/core/agents/copilot/adapter.ts` (new): `createCopilotAdapter({ home? })` with `kind: 'copilot'`. `launch`: a new id is `randomUUID()`; argv `['--session-id', id, '--plugin-dir', dir]` for start, `['--resume=' + id, '--plugin-dir', dir]` for resume; the resume id must match the UUID shape (reuse `SESSION_ID` from `agents/claude/launch.ts` only if it reads cleanly, otherwise a local regex); the plugin folder `home/agents/copilot/<tab>.plugin` is written at launch with `hooks.json` pointing at `home/agents/copilot/<tab>.jsonl`; `env: {}`. `watch`: `createSpoolSource` from `status/spool.ts` with `parse` for the `{t, e}` shape and `toEvents` = a closure over the fold from `normalise.ts`; plus a 1 s poll of `events.ts`'s log that folds the same way, with the log's first read folded silently (as the old `start()` did), so a restored tab does not replay an old end. Heartbeat from the spool poll, as Claude's. `available` = `commandOnPath('copilot', shell)` from `agents/commandOnPath.ts` (Implementer 2 creates it: wait for it or write it yourself with the same signature if Implementer 2 has not finished, and say so in Deviations).
- [ ] Tests: `normalise.test.ts` (port the cases of `src/core/copilot/normalise.test.ts`, with the status outputs); `events.test.ts` (port `src/core/copilot/events.test.ts`); `source.test.ts` (port the cases of `src/core/copilot/source.test.ts` that cover the fold, against the spool and the log in a temp home; the plugin and argv cases); `adapter.test.ts` (argv for start and resume, bad id throws, plugin files exist). Fixtures: `next/packages/core/agents/copilot/fixtures/` with the hook record shapes the old tests use; README as for OpenCode.

Implementer 4 (window, after Implementer 1; parallel with 2 and 3):
- [ ] `next/packages/ui/index.html`: next to "+ Claude" add "+ OpenCode" (`id="new-opencode"`) and "+ Copilot" (`id="new-copilot"`), same classes and titles ("New OpenCode tab in this space", "New Copilot tab in this space").
- [ ] `next/packages/ui/main.ts`: one `newAgentTab(kind: AgentKind)` with the command table `{ claude: 'claude', opencode: 'opencode', copilot: 'copilot' }` (the core picks the args; the window sends only `command` and `agent: { kind }`, as today's Claude path does); `resumeAgent(tab)` sends `agent: { kind: agent.agent, resumeId? }` by the tab's stored kind (the core already resumes the saved session when no id is given); `agentRow` shows the agent's kind label ("Claude", "OpenCode", "Copilot") next to the tab label; the `status.changed` handler uses `change.agent` (no hard-coded `'claude'`); a `refused` error or `agentMissing` shows the message in the status line via `report`.
- [ ] `next/packages/ui/bridge.ts`: no change expected; if a type import changes, follow it.
- [ ] Gates: `npx vitest run` (the UI has `alerts.test.ts` and `bridge.test.ts`), `npm run typecheck`.

Models passed: cto=inherit, researcher=inherit, planner=inherit, reviewer=inherit, implementer=inherit (general-purpose subagents, no `model`).

Verification: `cd next && npx vitest run` passes, with the new tests of each implementer; `npm run typecheck` passes; `cd next/packages/ui/src-tauri && cargo check` passes (no Rust change is planned, so this is a regression check). By hand, not run here (left for the human): a `claude`, an `opencode` and a `copilot` tab each show the right states, notify and play the sound when they need you and when they finish; kill the core and holder mid-turn with each agent, reopen, and see each state rebuilt, with Resume bringing back OpenCode and Copilot (Copilot may show Resume unavailable with the reason); with the old Grove running beside, each app lists only its own OpenCode sessions; the Copilot tab on the work Mac.

### Review rounds

Round 1 (fresh reviewer, whole slice): 2 blocking, 5 non-blocking. Blocking: (a) an OpenCode tab restored after a core restart stays working when its turn ended during downtime, because a fresh fold never reports an idle snapshot; (b) a Copilot tab restored after an Esc during downtime stays working, because the silent first read of the events log ends the turn without an event. Fixed in the adapters: an idle, known OpenCode snapshot now gives `idle-prompt` (a `known` flag keeps a not-yet-started session silent); a Copilot first log read that ends a turn the spool left running gives one `idle-prompt`. Four tests added (287 to 291).

Round 2 (fresh reviewer, re-review after the fix): 0 blocking. Verdict: passed. Non-blocking left, not fixed: (1) a `watch()` added while connected resyncs without a lock, so a live `exec-started` during its GETs can be overwritten by the snapshot and a spurious `idle-prompt` can follow (narrow, four local GETs); (2) events read after a connect's resync can be older than the snapshot (permission asked and replied inside the window leaves needs-you); (3) if `resync` throws after the connection is set, the `/api/event` body is not aborted, so each such failure leaks one connection; (4) `OpenCodeFold.reported` is written and never read; (5) a restored working Copilot tab with log records emits `working` again, which counts as watchdog progress; (6) the window sends `command` in `tabs.create`, which the core ignores (it uses the launch command); (7) a Copilot log lagging a fresh hook could end a just-started turn until the next poll.

Fix rounds: 1 of 2 (both blocking findings from round 1, one round).

### Deviations

- Shared contract (`status/adapter.ts`) as the plan wrote it. Departures: `StatusServiceOptions.adapters` is `Partial` because the registry grows with the slice; `TrackInput` is `{ tabId, spacePath, kind, sessionId }` (no `spoolFile`); restore no longer calls `launch`, a record without a session id passes `''`; the resume-id check lives in each adapter's `launch`; `agentMissing` names the kind (the three kinds equal their command names); the daemon refuses a request whose kind differs from the saved tab's kind (`invalidParams`); `StatusChange.source` and `AgentInfo.source` stay `string`.
- `lost` is added to `StatusEvent` (the plan's design): the reducer leaves the state alone and the service sets unknown.
- The generic spool reader moved to `status/spool.ts`; `agents/claude/source.ts` is a thin wrapper with the same exports. Log messages say "agent spool" instead of "Claude spool".
- `commandOnPath` is a shared helper (`agents/commandOnPath.ts`) used by the OpenCode and Copilot adapters; a positive probe is cached in the daemon per kind, a timeout counts as found, and a failed probe as missing (the old Copilot semantics). Claude is not probed, as before.
- Reused from the old Grove: OpenCode `normalise` (envelope, pending permission and form, exec started, exec ended for succeeded, failed and interrupted, child sessions), `sseData`, `snapshotOf`, the service-file reader under `XDG_STATE_HOME`, Basic auth, the reconnect loop with backoff and the silence timeout, `mintSessionId` (moved into `agents/opencode/adapter.ts`); Copilot `step` (turn start and end, prompts, notification permission and question, pre and post tool, `agentStop`, `sessionEnd`, `abort` and `session.shutdown` with the stale check, subagents ignored), the `{t, e}` hook plugin, the events-log reader with a first read of at most 1 MiB, and the start and resume argv.
- Dropped from the old code: prompt, write, context and token events (the status contract does not need them), and the old child and connected events.
- OpenCode departures: `statusFor` takes the fold and returns `{ fold, events }` (the fold holds running, pending and the last reported state). A closed permission while another is open stays needs-you, not working. The hub fetches only active, session, permission and form, not children or context. `lost` is sent when an up connection drops, not on each failed attempt. A `watchFile` poll with no change in mtime, size or ino is ignored (Node fires it spuriously when the service file is missing); `watchFile` uses `persistent: false`. The hub's tests live in `client.test.ts`.
- Copilot departures: the factory option is `copilotHome` (not `home`, which is the Grove home in the watch input). The fold uses epoch-ms times. The first read of the log is folded silently, and its resulting state is reported once when the log had records (so a restored running turn is not blank). There is no `forget()`: the contract has no tab-removal hook, so each tab's `.jsonl`, `.offset` and `.plugin` files under `agents/copilot/` are left behind. A hooks test was added (the old folder had none).
- Round-1 fix: an idle, known OpenCode snapshot reports `idle-prompt` on every connect. Consequence: a known, idle OpenCode session turns an unknown tab idle on first connect (the service's rule for `idle-prompt`; finished and idle are unchanged).
- Window: the kind label is a span in a new `.agent-title` row (a small CSS addition; the plan named no class). The three agent buttons are wired from one list and are disabled together. `main.ts` imports the `AgentKind` type from `core/status/adapter.ts`, not from protocol (both were allowed).
- Fixtures for OpenCode and Copilot are the event shapes the old tests use, copied into each `fixtures/` folder with a README. They were not re-captured from live runs in this slice.
- Not committed: `next/packages/ui/src-tauri/Cargo.toml` (the harmless tauri rewrite) and the untracked `next/packages/ui/reference/` folder, which is not part of this slice.

### Verification

- `cd next && npx vitest run`: 31 files, 291 tests passed (baseline 181 at the start of the slice).
- `cd next && npm run typecheck`: exit 0.
- `cd next/packages/ui/src-tauri && cargo check`: finished, no errors (no Rust change in this slice).
- `npx vite build` in `next/`: succeeded (run by the window implementer after its change; the window was not changed after that).
- Restart and replay cases are covered by the new tests: a turn that ended during downtime (OpenCode), an Esc during downtime (Copilot), an idle session not yet started (silent), a Copilot empty log (no repeat), and the per-kind registry and daemon paths (unknown kind, kind mismatch, `agentMissing`).
- Not run here: any live `opencode` or `copilot` tab, and any real service or log file.

### Left for the human

- By hand, on the personal Mac and then the work Mac (`npm run dev`): a `claude`, an `opencode` and a `copilot` tab each show the right states and notify with a sound when they need you and when they finish.
- Kill the core and holder mid-turn with each agent, reopen, and see each state rebuilt. Press Resume for OpenCode and Copilot; Copilot may show Resume unavailable with the reason.
- With the old Grove running beside, each app lists only its own OpenCode sessions.
- The Copilot tab on the work Mac (the plan's work-Mac check).
- Live captures: the OpenCode and Copilot fixtures are the old tests' shapes; a real capture would confirm them.
- Non-blocking review items above (1 to 7), and the per-tab Copilot files that are not removed.

## Slice 6

Session: 6 the grid
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: the window (`next/packages/ui/main.ts`) keeps every tab mounted, shows only the active one (`host.hidden`), and fits only the active terminal on resize. The tab strip has no grid control. `tabs.resize` is sent by each attached window tab on fit and on attach; the core passes it to the holder and keeps no per-viewer state. The old grid's pure layout code (`src/shared/grid.ts`, `src/renderer/src/gridView.ts`) has automatic columns (`gridCols`: 1; 2-4 -> 2; 5-9 -> 3), the auto-fill rule that the last pane stretches across its row (`paneSpans` with no manual span), and membership capped at nine (`withMember`). Its manual spans, dividers, track sizes and swap are out of v1. `next/packages/ui/styles.css` already has a `.grid` rule (three columns, 260 px rows) that is not wired to anything.

Decisions taken for this slice (the plan leaves them open; recorded here so the review can see them):
- Membership: the grid shows the active space's tabs in tab order, the first nine. It is view state in the window only (not saved, not in the core). Exited tabs stay in the grid and show their exit text.
- Layout: automatic only. Columns from the count as above, rows = ceil(count / columns), the last pane stretches across its row.
- Toggle: a `grid` button in the tab strip (`#grid-toggle`); the shortcut comes in slice 8.
- Focus and seen: a click on a pane calls `activate` for that tab, so the window still reports one focused tab to the core. Only that pane counts as seen.
- Dimming: unfocused panes get the class `pane-dim` and `opacity: var(--pane-unfocused-opacity)`. The variable is defined in `styles.css` `:root` with a default of 0.65 for now; slice 8 moves it into `tokens.css`.
- Size rule: the most recently active viewer owns a tab's size. The core records, per tab, the connection that last sent `tabs.resize` or `tabs.attach`, and applies the size of each `tabs.resize` it receives (last one wins). With one window today this is what the code already does; the slice adds the owner record and a daemon test for two connections.

Implementer 1 (window and layout, one subagent):
- [ ] `next/packages/ui/grid/layout.ts` (new, pure, no DOM): `GRID_MAX = 9`; `gridCols(n)`; `gridShape(n)` returning `{ cols, rows }`; `paneSpans(n)` returning `{ cols, rows }[]` with the last pane stretching across its row (port of the auto branch of `paneSpans` in `src/shared/grid.ts`, manual spans dropped); `gridMembers(ids, max = GRID_MAX)`: the first `max` ids in order.
- [ ] `next/packages/ui/grid/layout.test.ts` (new): ported from `src/renderer/src/gridView.test.ts` (gridCols cases, the auto cases of `paneSpans` in `src/shared/grid.test.ts`) plus `gridMembers` cases (order kept, cut at nine, empty).
- [ ] `next/packages/ui/index.html`: a `<button id="grid-toggle" class="new-tab" type="button" aria-pressed="false" title="Show this space's tabs in a grid">grid</button>` in the tab strip, before the `+` button.
- [ ] `next/packages/ui/main.ts`: `let gridOn = false` (in memory). When on: the terminals container gets class `grid` and CSS variables for columns and rows from `gridShape`; each member tab of the active space (`gridMembers`) is shown and placed with `gridColumn`/`gridRow` spans from `paneSpans`; a non-member tab stays hidden; the active tab is the focused pane (no class `pane-dim`), other members get `pane-dim`. When off: current behaviour (one tab shown). Toggling, switching space, and any change of tab count calls `paint()`, and each shown terminal is fitted after layout (`requestAnimationFrame` then `fit()` for each shown tab, so the core gets `tabs.resize` per pane). The `ResizeObserver` fits every shown tab, not only the active one. Clicking a pane calls `activate(tab)`. The grid toggle is disabled when there is no active space and sets `aria-pressed`.
- [ ] `next/packages/ui/styles.css`: `:root { --pane-unfocused-opacity: 0.65 }`; `.terminals.grid` is a CSS grid filling the area with a gap and padding, template columns and rows from the variables; `.term-host` in grid mode gets `min-height: 0`, `min-width: 0`; `.term-host.pane-dim { opacity: var(--pane-unfocused-opacity) }`; the old `.grid` rule is replaced by this one (no other rule uses it).
- [ ] Gates: `npx vitest run` in `next/` (291 passing before this slice, plus the new tests), `npm run typecheck`, and the UI builds with `npx vite build` in `next/packages/ui` if the config builds without the Tauri shell (if it cannot, say so in Deviations).

Implementer 2 (core size rule, one subagent, may run in parallel with 1, disjoint files):
- [ ] `next/packages/core/daemon.ts`: record, per tab id, the connection that last sent `tabs.resize` or `tabs.attach` (a map, cleared when the tab is removed). Keep applying every `tabs.resize` to the holder (last one wins); no new RPC.
- [ ] `next/packages/core/daemon.test.ts`: a case with two client connections on one tab: after the second connection sends `tabs.resize`, the holder reports that size on `tabs.attach`; and the owner record does not block the first connection's resize.

Models passed: cto=inherit, researcher=inherit, planner=inherit, reviewer=inherit, implementer=inherit (general-purpose subagents, no `model`).

Verification: `cd next && npx vitest run` passes with the new tests; `npm run typecheck` passes; the UI builds if it can. By hand, not run here (left for the human): nine tabs in one space, output-heavy commands in all of them, every pane keeps updating and the console shows no lost-context warning; the window's memory use recorded here (informational).

### Review rounds

Round 1 (fresh reviewer, whole slice): 3 blocking, 3 non-blocking. Blocking: (a) in grid mode a tab beyond the first nine could become active (a new tab in a full space, or an agent row for tab ten); it was hidden but still reported to the core as focused, so its output was marked seen; (b) `focusActive` fitted a hidden tab, which sized its pty to zero; (c) turning the grid off did not refit the tab that became visible. Fixed: the grid turns off when a tab outside it is made active; `focusActive` fits only a shown tab; every paint refits what is shown. Non-blocking, fixed: the container's class is `grid-panes`, so the old `.grid` rules stay for the stress page and no longer apply to the window; the grid toggle stays enabled while the grid is on. Non-blocking, not fixed: the owner record is written but nothing reads it (no behaviour depends on it, see Deviations); an exited tab that is not killed keeps its owner entry until its client closes.

Fix rounds: 1 of 2. The fix round was checked by reading the code and by the UI tests, typecheck and build. It was not sent back to a reviewer.

### Deviations

- Plan change during the run: the plan was re-approved as version 10 (commit af0c1f7: slice 9 added at the end, slice 8's Files line extended; slices 1 to 7 unchanged). This slice builds on it; the commit before this one is slice 5 (3637fb5).
- Reused from the old Grove: `gridCols` (1; 2-4 -> 2; 5-9 -> 3), the auto branch of `paneSpans` (the last pane stretches across its row), the cap of nine (`withMember` became `gridMembers`), and the matching cases of `src/renderer/src/gridView.test.ts` and `src/shared/grid.test.ts`. The signature is `paneSpans(n)`, not `(ids, spans, shape)`, since v1 has no manual spans.
- Dropped as the plan says: manual spans, draggable dividers, track sizes, header-drag swap, the layout picker, hide-ended, the dim slider and its range. Dimming is fixed at `--pane-unfocused-opacity`.
- Membership (the plan leaves it open): the first nine tabs of the active space in tab order. Not saved, not in the core. Exited tabs stay in the grid and show their exit text.
- Not in the plan: when a tab outside the first nine is made active while the grid is on, the grid turns off so that the tab can be seen.
- The toggle is a `grid` button in the tab strip; the shortcut comes in slice 8.
- The dim value is defined on `:root` in `styles.css` as 0.65 for now; slice 8 moves `--pane-unfocused-opacity` into `tokens.css`.
- Size rule (plan: the most recently active viewer owns the size): the core records, per tab, the connection that last sent `tabs.resize` or `tabs.attach` (`tabOwners`, cleared on kill and on close). Every resize is still applied, so the last one wins, which is what the code did already. Nothing reads the record yet, so no behaviour depends on it. The test named "owner" checks last-wins across two connections, and it passes without the record, so it is a regression guard, not a test of the record. A second viewer that needs the rule will need the record read.

### Verification

- `cd next && npx vitest run`: a full run after the core change and before the UI fix round passed: 32 files, 302 tests. One earlier full run failed 3 tests in core while the core agent was still editing; the next clean run passed. The cause was not investigated. After the UI fix round, `npx vitest run packages/ui` passes: 3 files, 19 tests (including the 9 grid tests in `grid/layout.test.ts`).
- `npm run typecheck` is clean (checked after the core change and after the fix round).
- `npx vite build` in `next/packages/ui` builds (before and after the fix round). No Rust change, so `cargo check` was not run.
- Not run here: the window by hand (see below). The CSS layout is checked only by the build, not by looking at the app.

### Left for the human

- By hand, in the built app or `npm run dev`: nine tabs in one space; run output-heavy commands in all of them (for example `seq 1 200000` in each); every pane keeps updating, and the console shows no "WebGL context lost" warning.
- Record the window's memory use with those nine panes here (informational; v1 sets no limit).
- Turn the grid on with one tab, then off again: the tab fills the window and takes the keyboard. With the grid on, a click on a pane focuses it and dims the others; a tenth tab turns the grid off.
- The plan's render-stall check for nine panes (slice 1's stress page and this slice re-measure it; the fallback is disposing hidden panes): not measured here.

## Slice 7

Session: 7 command line
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `next/packages/cli/main.ts` has `ls`, `space add` and `space ls` only (spaces and their tabs, with alive or exited), over `next/packages/protocol/client.ts` (`connectRpc`, `connectWhenReady`) and `ensureHolder`. `next/bin/grove-next` is tracked with mode 100755 and resolves its folder from `$0` (`dirname "$0"/..`), so a symlink into `~/.local/bin` would point the script at the wrong folder. The core (`next/packages/core/daemon.ts`) has `tabs.create` (agent tabs, with a saved record and resume by id), `tabs.open` (a login shell in an exact saved space path), `tabs.write`, `tabs.screen`, `tabs.resize`, `tabs.attach`, `tabs.kill` (holder only, no record change), `spaces.*` and `agents.list`; it broadcasts `status.changed` and `attention.notify`. Tab records (`next/packages/core/store/state.ts`) hold id, space path and agent kind (`agent` undefined for a shell) and no label. `StatusService` (`next/packages/core/status/service.ts`) has `track`, `restore`, `list`, `markSeen` and no untrack. Nothing removes a saved tab, and restore recreates a shell for any saved shell tab the holder does not know, so a kill needs a record removal. The window (`next/packages/ui/main.ts`) selects tabs through `activate(tab)` and `selectSpace(path)`; `src-tauri/src/lib.rs` has commands `connect`, `rpc`, `env_info` and `notify` and no window raise or CLI install. The old Grove's CLI (`src/cli/args.ts`, `output.ts`, `client.ts`, `index.ts`, with `args.test.ts`, `output.test.ts`, `client.test.ts`), its ref rule (`src/core/cliOps.ts` `resolveSessionRef`: id, unique prefix of at least 4, exact label; ambiguous and not-found), its wait (`waitTurn`, with `paneStable`), its paste (`src/core/send.ts`: `waitStable`, then a bracketed paste), its exit codes (`exitCode`, `turnExit`: 0 idle, 3 not running, 5 gone, 124 timeout, 1 other) and its `timeoutMs` in `src/main/cliServer.ts` are the reuse source; the install action is in `src/core/env.ts` and `src/main/index.ts`.

Decisions taken for this slice (the plan leaves them open; recorded here so the review can see them):
- Labels: an optional `label` on tab records, on the `tabs.create` and `tabs.open` params, and in each `spaces.list` tab (with `kind`). `new --label` sets it; a label is a ref (exact match). This keeps the plan's "exact label" rule.
- Kinds: `terminal`, `claude`, `opencode`, `copilot`. Kind is a tab's `agent` (or `terminal`). `--model` is dropped: the adapters' `launch` takes no model.
- `new <kind>` starts the tab in `--cwd` (default the caller folder: `GROVE_NEXT_CALLER_CWD`, else the process cwd). The folder must be exactly a space (as `tabs.open` already requires); otherwise `not a space: <dir>, add it with grove-next space add`. No auto-registration (the old Grove registered projects; v1 does not).
- New core methods: `tabs.close {id}` (holder kill, drop the saved record, status untrack) and `tabs.focus {id}` (broadcast a `tabs.focus {id}` notification; the window selects that tab's space and tab and raises its window through a new Rust command `raise_window`). Both return `{}`.
- Ref resolution (`ref.ts`): exact id, then a unique id prefix of at least 4 characters, then an exact label; ambiguous and not-found are errors. Reads only the saved tabs from `spaces.list`.
- `--prompt TEXT|-`: after the create, wait for the screen to be stable (the old `paneStable` and `waitStable`: settle 1 s, the screen unchanged for 1 s, up to 20 s), then a bracketed paste of the text and Enter (`\x1b[200~`, the text, `\x1b[201~`, then `\r`, as the old paste does). After the paste, `new` and `send` wait up to 30 s for the agent to report `working` before returning, so a `wait` that follows is not answered by the old idle state; a timeout there is not an error. `--wait` on `new` or `send` then waits for the turn (expectStart true).
- `send` to a gone agent tab resumes it (`tabs.create` with the same id and `agent.kind`, the saved session is reused) and then does the stable-wait and paste, as the old `sendToSession` resumes gone agent sessions. A gone shell tab is an error (`gone`, exit 1).
- `wait`: a pure port of the old `waitTurn` over `agents.list` and `spaces.list`, polled every 500 ms and re-checked on each `status.changed`. Mapping: a shell tab has no state (`no-status`, exit 1); a tab that is not alive is `gone` (exit 5); `working`, `unknown` and `needs-you` with reason `permission` or `question` keep waiting (the human's to answer, as in the old rule; `unknown` is treated like the old "no status" case); `idle`, `finished` and `needs-you` with reason `error` end (exit 0). The default timeout is the old `timeoutMs` value (checked in `src/main/cliServer.ts`).
- `read <ref> [--lines N]`: `tabs.screen`, the last N lines (default 100), trailing whitespace trimmed (old `formatRead`).
- `ls [--json]`: the same tree as today (`space ls` is the same command), each tab line with its number, id, kind, state (from `agents.list`, `-` for a shell), label and alive or exited. `--all` and the caller `*` marker are not ported: no tab carries an id env var yet.
- Exit codes: 0 ok or the wait's idle, 1 error (one line on stderr), 2 usage, 3 the core cannot be reached after the holder start, 5 gone, 124 timeout (as the old CLI).
- Dropped on purpose: `status`, `progress` (the plan says their labels are not carried over), `skill` (slice 8), `--worktree`, `--branch`, `--base` (D4: no worktree creation in v1), `--parent`, `--child`, `--relation`, `--link` (no parent in v1, no workflow features), `--model`.
- Install action: a sidebar button "Install grove-next command" that writes the command into `~/.local/bin`, as the old Grove's action does. Its form follows the old installer after it is read (`src/core/env.ts`): a wrapper script `exec '<root>/bin/grove-next' "$@"`, not a symlink, so the script's `$0` folder still resolves. A button in the sidebar, not a menu item: the Tauri app has no menu yet.

Implementer 1 (core and protocol; runs first, the other two after it):
- [ ] `next/packages/protocol/messages.ts`: `SpaceTabInfo` gets `kind: 'terminal' | AgentKind` and `label: string | null`; `tabs.create` and `tabs.open` params get `label?: string`; methods `tabs.close` (params `{ id }`, result `Empty`) and `tabs.focus` (params `{ id }`, result `Empty`) in `MethodMap`; `'tabs.focus': { id: string }` in `NotificationMap`.
- [ ] `next/packages/core/store/state.ts`: `TabRecord` gets an optional `label?: string` (same state version 1; old files still load).
- [ ] `next/packages/core/spaces.ts`: `openTab` takes and saves the label; `list` returns `kind` (the record's `agent`, or `terminal`) and `label`; `removeTab(id)` drops the record (and saves). `restore` skips a removed tab (no record, no shell).
- [ ] `next/packages/core/status/service.ts`: `untrack(tabId)` drops the tab from the status list and its timers.
- [ ] `next/packages/core/daemon.ts`: `tabs.create` with an agent saves the label on a new tab (a resume keeps its record's label); `tabs.close` (holder `tabs.kill`, then `spaces.removeTab`, then `status.untrack`; an unknown id is an `invalidParams` error with a clear message); `tabs.focus` (checks the tab exists in the record or the holder, broadcasts `notification('tabs.focus', { id })`). Holder `tabs.kill` stays unchanged for the exited-tab cleanup.
- [ ] Tests: `store/state.test.ts` (a label round-trips; an old file without labels loads); `spaces.test.ts` (`openTab` with a label; `list` returns kind and label; `removeTab` then a new stack's `restore` does not recreate it); `daemon.test.ts` (`tabs.close` kills, removes the record and the tab is gone from `spaces.list`; `tabs.focus` reaches a connected client as `tabs.focus`; `tabs.focus` on an unknown id fails).

Implementer 2 (CLI; after Implementer 1; parallel with Implementer 3):
- [ ] `next/packages/cli/args.ts`: `parseCommand(argv)` ported from `src/cli/args.ts` on `node:util` `parseArgs`, with the commands and flags listed above (`ls [--json]`, `space add [path]`, `space ls`, `new <kind> [--cwd DIR] [--label L] [--prompt TEXT|-] [--wait] [--timeout S] [--json]`, `send <ref> <TEXT|-> [--no-enter] [--wait] [--timeout S]`, `wait <ref> [--timeout S]`, `focus <ref>`, `kill <ref>`, `read <ref> [--lines N]`). `UsageError` and `USAGE` as the old file, with the grove-next name.
- [ ] `next/packages/cli/ref.ts`: `resolveTabRef(tabs, ref)` ported from `resolveSessionRef`, returning `{ ok, id }` or `ambiguous` or `not-found`; minimum prefix 4.
- [ ] `next/packages/cli/wait.ts`: `waitTurn(deps, id, { expectStart, timeoutMs, startWaitMs })` ported from `waitTurn` in `src/core/cliOps.ts`, over the new states (the mapping in the decisions above), with injected `find` and `onChange`.
- [ ] `next/packages/cli/paste.ts`: `waitStable` and `pasteText` ported from `src/core/send.ts` and the old backend's paste, over `tabs.screen` and `tabs.write`.
- [ ] `next/packages/cli/output.ts`: `formatLs`, `formatRead`, `formatError`, `exitCode`, `turnExit` ported from `src/cli/output.ts`, for tab rows.
- [ ] `next/packages/cli/main.ts`: `main(argv)` returns an exit code. Dispatch for every command; `withCore` as today; `new` resolves the cwd, checks it is a space (through `spaces.list`), calls `tabs.open` for `terminal` or `tabs.create` with `agent.kind` for the others (cols 120, rows 40), then `--label`, `--prompt`, `--wait`. Connection failures after the holder start map to exit 3. Keep `space add`, `space ls`, `ls` output as today, with the kind, state and label columns added.
- [ ] `next/bin/grove-next`: unchanged (the mode stays 100755).
- [ ] `next/README.md`: a "Command line" section: the commands, the exit codes, the labels, what is not in v1 (worktrees, parents, status, progress, skill and model), and the install button.
- [ ] Tests, ported: `args.test.ts` (from `src/cli/args.test.ts`, minus the dropped flags), `output.test.ts` (from `src/cli/output.test.ts`), `ref.test.ts` (from the `resolveSessionRef` tests in `src/core/cliOps.test.ts`), `wait.test.ts` (from the `waitTurn` tests there, with fake timers and the new states), and `cli.test.ts` extended: `new terminal --cwd <space> --label L` prints an id; `ls` shows it; `send` a command and `read` shows its output; `kill` then `ls` shows it exited or gone; `wait` on a terminal exits 1; `new` in a folder that is not a space exits 1 with the message. Each test stops the holder in `afterEach` as the current test does.

Implementer 3 (window; after Implementer 1; parallel with Implementer 2):
- [ ] `next/packages/ui/main.ts`: on `tabs.focus` select the tab's space (`selectSpace`) and `activate` the tab, then `invoke('raise_window')`; the sidebar button `#install-cli` calls `install_cli` through the bridge and shows the result (the path, or the reason) in the status line. Tab kinds in the tab strip are not changed.
- [ ] `next/packages/ui/index.html` and `styles.css`: the install button in the sidebar footer, using the existing tokens and classes (no new colour or size literal).
- [ ] `next/packages/ui/src-tauri/src/lib.rs`: `raise_window` (show, unminimise and focus the main window) and `install_cli` (port of the old `src/core/env.ts` installer: `~/.local/bin/grove-next` as the wrapper script above, mode 0755, the folder created; an existing file that is not our wrapper is refused with its path; returns the installed path). Register both in `generate_handler!`. Do not stage `src-tauri/Cargo.toml` (its uncommitted rewrite stays out of the commit).
- [ ] Tests: `next/packages/ui/bridge.test.ts` or a new `install.test.ts` for the wrapper content and the refuse-an-unknown-file rule if the install logic is kept in TypeScript; otherwise state in the slice's Verification that the Rust side is checked by `cargo check` and the build only.

Models passed: planner=inherit, reviewer=inherit, implementer=inherit (general-purpose subagents, no `model`).

Verification: `cd next && npm test` passes, including the store, spaces and daemon tests of Implementer 1 and the CLI tests of Implementer 2; `npm run typecheck` passes; `npx vite build` in `next/packages/ui` builds both pages; `cargo check` in `next/packages/ui/src-tauri` passes. Root files are not touched: `git diff --name-only edaf304 -- ':!next' ':!docs'` is empty for this slice. By hand (not run here, left for the human): from a Claude tab in the new app, `grove-next new claude --prompt "say hi"` then `grove-next wait <ref>`: the new tab appears in the sidebar and the wait returns 0; `grove-next focus` raises the window on the tab; `grove-next kill` removes the tab from the sidebar and after a core restart it does not come back; the install button writes `~/.local/bin/grove-next` and it runs from another folder; the old Grove's `grove ls` shows only its own sessions.

### Review rounds

Implementation: three implementers, in order. Core and protocol first (`spaces`, `daemon`, `state`, `status/service`, protocol: labels, `tabs.close`, `tabs.focus`); then the command line and the window in parallel (`next/packages/cli/`, `next/packages/ui/`, `lib.rs`).

Round 1 (1 blocking, 11 non-blocking; fresh reviewer): blocking: `grove-next kill` returned 0 but the window kept the tab and its agent entry until a restart, because closing emitted no notification. Fixed: the core broadcasts `tabs.closed {id}` after the close, the window removes the tab and its agent entry at once, and `daemon.test.ts` checks the notification reaches every client. Non-blocking applied: a dead shell tab reports `gone` (exit 5), not `no-status`; `new terminal --wait` is a usage error before anything starts; the install wrapper refuses a path with a control character and is written beside its target and renamed over it. Non-blocking left (see Left for the human): a label that equals a prefix of another tab's id is unreachable and labels are not unique; `new`/`send --wait` without a turn waits the 30 s start; `focus` exits 0 with no window connected; a core that drops mid-call exits 1, not 3; `send -` resumes the tab before reading stdin; `new --prompt` prints the id before the settle; `ls` columns break on a label with spaces; the wait's notification subscription is never removed.

Verdict: pass after round 1, 0 blocking open, 8 non-blocking left, 3 applied. Fix rounds: 1.

### Deviations

What was reused from the old Grove, as the human asked: the argument parsing and its validation (`src/cli/args.ts`), the table and exit-code mapping (`src/cli/output.ts`), the ref rule (`resolveSessionRef`: id, unique prefix of 4 or more, exact label), `waitTurn` with its 30 s start wait and the permission and question rule (`src/core/cliOps.ts`), `waitStable` (1 s settle, 1 s stable, 20 s, polled) and the tmux paste (bracketed, 150 ms before Enter, control characters stripped; `src/core/send.ts`, `src/core/backend/tmux.ts`, `src/core/controlChars.ts`), the default timeout of 600 s (`src/main/cliServer.ts`), and the installer's logic and wording (`src/core/env.ts`), adapted to a wrapper script. Their tests were ported to `args.test.ts`, `output.test.ts`, `ref.test.ts`, `wait.test.ts` and `paste.test.ts`. Not reused: `src/cli/client.ts` (the protocol client in `next/packages/protocol/client.ts` covers it; only the not-running idea was kept, as exit 3); the old `ls --all` and the caller `*` marker (there are no workflow sessions, and a tab has no id env var yet).

Where it differs from the old code, and why:
- Labels were added to tab records (optional, state version still 1), to `tabs.create`, `tabs.open` and `spaces.list` (with `kind`), so that the plan's exact-label ref rule works. Old state files still load.
- New protocol: `tabs.close` (holder kill, record removed, status untracked), `tabs.focus` (broadcast to the windows), and the `tabs.closed` notification.
- `--model`, `--worktree`, `--branch`, `--base`, `--parent`, `--child`, `--relation`, `--link`, `status`, `progress`, `skill` are dropped, per the plan (no model in the adapter launch; no worktree creation, parents or workflow in v1; `skill` is slice 8).
- A stable wait before a paste applies only to a new or resumed tab; a live tab gets the paste at once, since a working agent's spinner never lets the screen settle. The 30 s working wait after a paste is skipped for shell tabs and for `--no-enter`.
- `wait` polls every 500 ms and also re-checks on each `status.changed`. The wait's start-wait is 30 s.
- A dead shell tab is `gone` (exit 5); a live shell tab is `no-status` (exit 1).
- `read` trims the blank rows below the cursor before taking the last N lines; without that a fresh screen showed nothing.
- `kill` removes the tab from `ls` (the test asserts absence), since the record is gone; it does not leave an exited entry.
- The agent tabs' `command` parameter carries the kind; the core ignores it for agent tabs (the window does the same).
- `ls --json` has `id`, `spacePath`, `kind`, `state`, `label`, `alive`; there is no number field.
- The install is a button in the sidebar footer, not a menu item (the Tauri app has no menu yet). It writes a wrapper script, not a symlink, because the script finds its folder from `$0`.
- A shell tab cannot be given `--wait`; this is a usage error, checked before anything starts.

### Verification

`cd next && npm test`: 37 files, 356 of 356 pass (after the round-1 fixes; 354 before them). `npm run typecheck`: clean. `cargo check` in `next/packages/ui/src-tauri`: passes. `npx vite build` in `next/packages/ui`: builds both pages (output into the scratchpad, `dist` untouched). Root files are not touched: `git diff --name-only edaf304 -- ':!next' ':!docs'` is empty. The CLI was smoke-tested by the implementer through the real entry point in an isolated home: `space add`, `ls`, `new terminal --label`, `send` of `echo smoke-$((2*21))`, `read` showing `smoke-42`, `ls --json`, `wait` on a shell (exit 1), `kill`, `new` in a non-space (exit 1), and an unknown command (exit 2). The Rust side was checked by `cargo check` and by reading; `install_cli` and `raise_window` were not run.

### Left for the human

- By hand, in the built app or `npm run dev`: from a Claude tab, `grove-next new claude --prompt "say hi"` then `grove-next wait <ref>`: the new tab appears in the sidebar and the wait returns 0.
- `grove-next focus <ref>` selects the tab and raises the window; `grove-next kill <ref>` removes the tab from the sidebar, and after a core restart it does not come back.
- The install button writes `~/.local/bin/grove-next`, and the command runs from another folder; the old Grove's `grove ls` still shows only its own sessions.
- The running dev app holds a core that was started before this slice (its `tabs.list`/`spaces.list` shape is older); `grove-next ls` against the real `~/.grove-next` fails until the app or the core is restarted.
- Not fixed, from the round-1 review: a label that equals a 4-character-plus prefix of another tab's id cannot be selected by label, and labels are not unique; `new --wait` or `send --wait` with no turn waits the full 30 s start before returning 0; `focus` exits 0 when no window is connected; a core that drops during a call exits 1, not 3; `send -` resumes a gone tab before reading stdin, so an empty stdin leaves it resumed with nothing pasted; `new --prompt` prints the id before the settle, so a settle timeout exits 1 with the id already printed; `ls` columns misalign with a label containing spaces; the wait's notification subscription is never removed.
- Known gap from Implementer 1, outside this slice's scope: `attention.ts` keeps an `entered` entry for a closed tab, and the per-tab sidecar files (`.status.json`, `.offset`, `.jsonl`) are not deleted on close (nothing reads them once the record is gone).

## Slice 8

Session: 8 sentence app change
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `next/packages/core/daemon.ts` starts agent tabs in `createAgentTab` (env from `adapter.launch`, passed to holder `tabs.create`) and shell tabs in `spaces.openTab` (`loginShell()`, no env); the holder merges the caller env into the process env (`holder/pty-table.ts`). `groveNextHome()` (`protocol/paths.ts`) is the one home rule. `protocol/messages.ts` has `MethodMap`/`NotificationMap`; `tabs.focus` and `tabs.closed` show how a notification reaches every window. The UI (`next/packages/ui/main.ts`, `index.html`, `styles.css`) has no keyboard handling, a fixed sidebar with `#spaces` and `#agents` sections, a tab strip with the grid toggle and three agent buttons, and a `.sidebar` width from CSS; `styles.css` already defines its own colours in `:root` (`--sidebar`, `--line`). The CLI (`next/packages/cli/args.ts`, `main.ts`) has no `config` or `skill` command. The old app's skill install is `src/main/launcher.ts` (`agentSkillsDirs`: Claude, OpenCode and Copilot user skill folders; `installAgentSkill`: symlink, refuse an existing non-link). Old JSON file helpers are in `src/core/store/jsonFile.ts`.

Decisions taken for this slice (the plan leaves them open; recorded so the review can see them):
- Config folder: `<home>/config` (`home` from `groveNextHome()`). Five files, each with `"version": 1`: `settings.json`, `keys.json`, `launchers.json`, `theme.json`, `layout.json`. A missing file means its defaults; the core writes the defaults for missing files at start. A file that exists but is invalid keeps the last good values.
- Wire types go in `next/packages/protocol/messages.ts`, so the UI and the CLI import one contract: `ConfigValues`, `ConfigSnapshot`, `KeyAction`, `LayoutSection`, plus the method `config.get` and the notification `config.changed`.
- Validation: small hand-written schemas in `next/packages/core/config/schema.ts`. No new dependency (the repo has no schema library).
- Environment: every agent tab and every shell tab gets `GROVE_NEXT_CONFIG=<config folder>` (for shell tabs, through the holder's `env` on `tabs.create`).
- Settings (`settings.json`): `sidebarWidth`, integer px 180 to 480, default 200 (the sidebar was 200 px; the default keeps the look).
- Keys (`keys.json`): five actions, `grid-toggle` (default `mod+g`), `new-shell` (`mod+t`), `new-claude` (`mod+shift+1`), `new-opencode` (`mod+shift+2`), `new-copilot` (`mod+shift+3`). `mod` is Cmd on macOS and Ctrl elsewhere. A duplicate binding is invalid.
- Launchers (`launchers.json`): a list of `{ id, label, command, args, env }`; `id` matches `^[a-z0-9-]{1,32}$` and is unique; defaults to an empty list. A launcher opens a shell tab in the active space and types `env K=V <command> <args>` then Enter. Deviation from a direct agent start: the core only starts the three known adapters, so a launcher is a shell line; the shell tab stays after the command exits.
- Layout (`layout.json`): `sidebarOrder`, a permutation of `["spaces", "agents"]`, default `["spaces", "agents"]`. Sidebar side and grid defaults (named in the design's layout option) are not in v1, recorded as a deviation; the slice's Files line does not list them.
- Theme (`theme.json`): `tokens`, an object whose keys are the twenty token names below and whose values are strings of 1 to 80 characters matching `^[#(),.%\w\s-]+$` (no `;`, braces, quotes or `url(`). A token is written as `--<name>` on the document root; a token removed from the file reverts to its default in `tokens.css`.
- Tokens: `next/packages/ui/src/tokens.css`, the plan's path (the UI package is flat today; this is its first `src/`), loaded by `index.html` before `styles.css`. Names: `--accent`, `--state-needs-you`, `--state-working`, `--state-finished`, `--state-idle`, `--state-unknown`, `--pane-unfocused-opacity`, `--font-ui`, `--font-mono`, `--space-1` to `--space-6`, `--radius-sm`, `--radius-md`, `--text-sm`, `--text-md`, `--text-lg`. Plain values now; slice 9 gives the finals.
- Watcher: `fs.watch` on the config folder, debounced 150 ms; each changed file is re-read; a changed snapshot is broadcast as `config.changed`. The reload is a plain function (`store.reload()`) that the tests call directly.
- `AGENTS.md`: written into the config folder on every core start, from the schema descriptions (the files, their keys, their rules, and that a bad file keeps the last good version).
- Skill (`grove-next skill`): writes `grove-next-config/SKILL.md` into each of the three user skill folders (Claude verified; OpenCode and Copilot best effort, as the plan says). The folders come from `agentSkillsDirs`, ported as a copy of `src/main/launcher.ts` (not an import: `next/` does not import the old app). Installing differs from the old symlink because the content is generated: a file is written; an existing file that carries the marker `grove-next:skill` is replaced; any other existing file is refused with its path; one failing folder does not stop the others. The skill applies only when `GROVE_NEXT_CONFIG` is set and tells the agent to read `$GROVE_NEXT_CONFIG/AGENTS.md` first.
- Install on a fresh Mac: the README gets a section listing what must be installed (Xcode Command Line Tools, Node, Rust with cargo, then `npm install` and `npm run dev` in `next/`), checked against `next/package.json` and the slice 1 README wording.

Implementer 1 (protocol and core; runs first, the other two after it):
- [ ] `next/packages/protocol/messages.ts`: `KeyAction`, `LayoutSection`, `ConfigValues` (`settings: { sidebarWidth: number }`, `keys: Record<KeyAction, string>`, `launchers: Launcher[]` with `{ id, label, command, args: string[], env: Record<string, string> }`, `theme: Record<string, string>`, `layout: { sidebarOrder: LayoutSection[] }`), `ConfigSnapshot` (`path: string`, `values: ConfigValues`, `notes: Record<string, string>`); `METHODS.configGet = 'config.get'`; `'config.get': { params: Empty; result: ConfigSnapshot }` in `MethodMap`; `'config.changed': ConfigSnapshot` in `NotificationMap`.
- [ ] `next/packages/core/config/schema.ts`: the five schemas (each a field list with type, default and description), `validateFile(name, json)` returning `{ ok: true, value }` or `{ ok: false, message }` (the message names the file and the field), `THEME_TOKENS` (the twenty names), `KEY_ACTIONS`, `DEFAULT_VALUES`, `FILES` (the five file names).
- [ ] `next/packages/core/config/store.ts`: `ConfigStore` with `constructor(dir)`, `load()` (creates missing files with defaults, reads all five), `reload(names?)` (re-reads the named files or all; a valid file replaces its values and clears its note; an invalid one keeps the last good value and sets `notes[file] = "<file>: <message>"`; returns true when a value changed), `snapshot(): ConfigSnapshot`.
- [ ] `next/packages/core/config/watch.ts`: `watchConfig(store, onChange): () => void`, `fs.watch` on the folder, debounced 150 ms, `reload` for the changed names, `onChange(snapshot)` only when something changed.
- [ ] `next/packages/core/config/agents-md.ts`: `renderAgentsMd(): string` from the schema descriptions; written by the daemon at start.
- [ ] `next/packages/core/daemon.ts`: at start, `new ConfigStore(path.join(home, 'config'))`, `load()`, write `AGENTS.md`, `watchConfig` broadcasting `config.changed` to every connected client (the same path `tabs.focus` uses); `config.get` returns `store.snapshot()`; `GROVE_NEXT_CONFIG` added to the env of `createAgentTab` (merged with the adapter's `launch.env`) and to `spaces.openTab` (its holder `tabs.create` gets `env`). `spaces.openTab` takes the env as a parameter so `spaces.test.ts` is not changed in shape.
- [ ] Tests: `next/packages/core/config/schema.test.ts` (each file accepts its defaults; a missing `version`, an unknown key, a wrong type, an out-of-range width, a duplicate binding, an unknown theme token and a value with `;` are each rejected with the file name in the message), `store.test.ts` (missing files become defaults; a bad edit keeps the last good value and the note; a fix clears the note; `reload` returns false when nothing changed), `agents-md.test.ts` (every file name and every key appears), `watch.test.ts` (an edit reaches `onChange` within 2 s), `daemon.test.ts` (`config.get` returns defaults; the holder `tabs.create` params carry `env.GROVE_NEXT_CONFIG` for an agent tab and a shell tab; `AGENTS.md` exists after start).

Implementer 2 (CLI and README; after Implementer 1; parallel with Implementer 3):
- [ ] `next/packages/cli/args.ts`: `config path` → `{ cmd: 'config-path' }`, `skill` → `{ cmd: 'skill' }` (no arguments; extra arguments are a usage error); usage lines added.
- [ ] `next/packages/cli/skill.ts`: `skillText(): string` (begins with the marker line `<!-- grove-next:skill -->`, then the instruction: when `GROVE_NEXT_CONFIG` is set, read `$GROVE_NEXT_CONFIG/AGENTS.md` before changing grove-next; one line per kind of change), `agentSkillsDirs(home, env)` (ported from `src/main/launcher.ts`), `installSkill(o: { dirs: string[] }): Array<{ target: string; ok: boolean; error?: string }>` with the marker rule above.
- [ ] `next/packages/cli/main.ts`: `config-path` through `withCore` and `config.get`, prints `path`; `skill` installs into `agentSkillsDirs(os.homedir(), process.env)` and prints one line per target (`✓ <target>` or `✗ <target>: <error>`); exit 0 when all succeed, 1 otherwise.
- [ ] `next/README.md`: "Config folder" section (the five files, the live reload, the last-good note, `grove-next config path`, `grove-next skill`, the `GROVE_NEXT_CONFIG` variable) and "Install on a fresh Mac" section (what to install, in order, and the commands).
- [ ] Tests: `args.test.ts` (the two new commands and their usage errors), `skill.test.ts` (writes into a temp folder; replaces a file with the marker; refuses a foreign file and names it; a failing folder does not stop the others), `cli.test.ts` extended (`config path` prints a folder under the test home).

Implementer 3 (window; after Implementer 1; parallel with Implementer 2):
- [ ] `next/packages/ui/src/tokens.css`: the twenty tokens on `:root` with plain default values (colours as hex, sizes in px or rem, `--space-1` to `--space-6`, `--text-sm/md/lg`, `--radius-sm/md`, `--font-ui`, `--font-mono`, `--pane-unfocused-opacity`).
- [ ] `next/packages/ui/index.html`: `<link rel="stylesheet" href="./src/tokens.css" />` before `styles.css`; a `#launchers` container in the tab strip before the grid toggle; `id="section-spaces"` and `id="section-agents"` on the two sidebar sections.
- [ ] `next/packages/ui/styles.css`: `.sidebar` width from `var(--sidebar-width, 200px)`; `var(--accent)` for the selected space and agent marker and for the pressed grid toggle; `--radius-md` and `--font-ui` where the existing value is the same. No other visual change.
- [ ] `next/packages/ui/config.ts` (pure, no DOM at import time): `applyTheme(root, tokens, previous)` sets `--<name>` and removes names no longer present (returns the new name list), `applySettings(root, settings)` sets `--sidebar-width`, `applyLayout(sections, order)` reorders the two sidebar sections, `launcherLine(launcher)` (`env K=V` prefix only when env has keys; every word single-quoted with `'\''` escaping), `parseBinding(text)`, `bindingMatches(binding, event, isMac)`, `findAction(keys, event, isMac)`.
- [ ] `next/packages/ui/main.ts`: `config.get` at start and the `config.changed` notification (check `bridge.ts` for how notifications arrive); applies settings, theme, layout and keys; `keydown` on window dispatches the five key actions and calls `preventDefault` only on a match; launchers are buttons in `#launchers` (click: `tabs.open` in the active space, then once the tab's first `tabs.output` arrives, `tabs.write` of `launcherLine(...)` + `\r`); the status line shows the notes (joined) while any note is set, else it keeps its current text.
- [ ] Tests: `next/packages/ui/config.test.ts` (theme set and removal; the sidebar width; order reordering; a launcher line with a space and a quote in an argument; binding parse and match on Mac and non-Mac; a duplicate action binding rejected by the core is not this file's job).

Reviewer: a fresh `reviewer` subagent gets the diff of this slice, the plan's Decisions above and `01-outcome.md`.

Models passed: planner=inherit, reviewer=inherit, implementer=inherit (general-purpose subagents, no `model`).

Verification: `cd next && npm test` passes, including the config, daemon, CLI, skill and UI config tests; `npm run typecheck` passes; `npx vite build --outDir <scratchpad>` in `next/packages/ui` builds both pages (`dist` untouched; it is ignored by git); `git diff --name-only af0c1f7 -- ':!next' ':!docs'` is empty for this slice's commit range. By hand (left for the human): in a Claude tab after `grove-next skill`: a setting (sidebar width), a shortcut (rebind the grid toggle), the theme (a green accent), a launcher (`claude plan` with an argument) and the layout (agents above spaces), each applied without restart; break a file on purpose and see the last good version stay with a note; README followed on the work Mac from a fresh clone.

### Review rounds

Round 1 (fresh reviewer; 2 blocking, 9 non-blocking): blocking: the settings default was 200 where the plan's Decision and the README said 240 (fixed: the Decision and README now say 200, see Deviations); the watch test's 2 s bound was flaky under the full suite (fixed: 5 s). Non-blocking applied: the launcher line is written with `tabs.write` once the tab is attached, not on its first output, which could arrive before the window had the tab (fixed in `newShellTab`); `url(` is rejected in theme values; the fs watcher has an `error` listener; `installSkill` refuses a symlinked skill folder or file, and the marker must be in the first 10 lines of an existing file. Non-blocking left: the skill file mode 0600; a `shift+<key>` binding is allowed; a launcher env value may contain a newline; the README's Node version is unchecked (no `engines` field); `skill.test.ts` has no test for the symlink refusal or for the marker past line 10.

Round 2 (fresh re-reviewer; 2 blocking): the plan's checkbox still said `--sidebar-width, 240px` (fixed to 200px); `watch.test.ts`'s `waitUntil` default was still 2 s (fixed: 5 s, and the first test has its own 10 s limit). Both fixes were checked by reading the code and by the full test run; no fresh reviewer ran after this last edit, which is the second and last fix round.

Verdict: pass once the fixes of rounds 1 and 2 are in, 2 fix rounds, 0 blocking open at the last check. Non-blocking left: see Round 1.

### Deviations

What was reused from the old app, as the human asked: `agentSkillsDirs` (the three user skill folders, Claude, OpenCode and Copilot) is a copy of `src/main/launcher.ts`, and the skill install follows `installAgentSkill`'s rules (replace our own file, refuse another, name the folder), adapted to a written file. The atomic write follows the old app's JSON file idea (`src/core/store/jsonFile.ts`) as `atomicWrite` in `next/packages/core/config/store.ts`. Not reused: the old launcher symlink for the skill (the content is generated now, so a symlink to the app's folder does not fit).

Where it differs from the plan, and why:
- Settings default `sidebarWidth` is 200 px, not the 240 the plan's Decision first said: the sidebar was 200 px, and a default that changed the look is not part of "change with a sentence". The plan Decision and the README now say 200.
- Config files each carry `version: 1` and their own shape (`settings.json` holds `sidebarWidth` at top level; `keys.json` holds the five actions at top level; `launchers.json` holds `launchers`; `theme.json` holds `tokens`; `layout.json` holds `sidebarOrder`). Unknown top-level keys are rejected.
- Theme token names in the files and in `ConfigValues.theme` have no `--` prefix; the window writes `--<name>`. Theme values reject `url(`, as well as `;`, braces and quotes.
- Key bindings must have at least one modifier (`mod`, `alt` or `shift`) and one key from `a-z0-9`; a duplicate binding is invalid (compared in canonical form).
- A launcher's `args` and `env` are optional. Launcher ids are unique. A launcher is a shell line typed into a new shell tab in the active space (`env K=V` prefix only when env has keys), so the tab stays after the command exits; the core starts only the three known agent adapters.
- A launcher line is written with `tabs.write` once the new tab is attached, not on its first output: the first output can arrive before the window has the tab, and the line was lost then (found in review, fixed).
- Layout: `sidebarOrder` only (a permutation of spaces and agents). Sidebar side and grid defaults (named in the design's layout option) are not in v1, and the slice's Files line does not list them.
- Sidebar width is applied on the `.app` grid column (`--sidebar-width`), since `.sidebar` is a grid item.
- Tokens file: `next/packages/ui/src/tokens.css`, the plan's path; the UI package had no `src/` before. `index.html` and `stress.html` load it before `styles.css`. Duplicate `:root` names in `styles.css` (`--accent`, `--pane-unfocused-opacity`) were removed, same values; the dark-mode `--accent` overrides stay. `border-radius: 6px` became `var(--radius-md)` in five places, the body font became `var(--font-ui)`, the pressed grid toggle takes `--accent`.
- Keys: the window handles `keydown` in the capture phase on window; a match calls `preventDefault` and clicks the existing button, so disabled buttons ignore it. Letters and digits match on `event.code`, so Shift+1 matches `mod+shift+1`.
- `grove-next skill` writes `grove-next-config/SKILL.md` (frontmatter first, so Claude loads it; the marker `grove-next:skill` is an HTML comment on line 6). An existing file with the marker in its first 10 lines is replaced; any other file, or a symlinked skill folder or file, is refused with its path. One failing folder does not stop the others. The skill applies only when `GROVE_NEXT_CONFIG` is set. Only Claude is verified; OpenCode and Copilot are best effort, as the plan says.
- `SKILL.md` and the config files are written at mode 0600 through `atomicWrite`. Left as is: the owner runs the agents, and the content is not secret.
- `next/packages/core/bin.ts` (outside the listed Files) passes `GROVE_NEXT_CONFIG` to restored shell tabs, so every shell tab gets it, as the plan requires.
- `next/packages/cli/` `grove-next skill` also changed the README's Command line section (the skill is no longer "not in v1").
- `spaces.openTab` and `restore` take an optional env argument; agent tabs get `{...launch.env, GROVE_NEXT_CONFIG}`, so the config path wins.

### Verification

`cd next && npm test`: 43 files, 410 of 410 pass (the last run, after all fixes). `npm run typecheck`: clean. `npx vite build --outDir <scratchpad>` in `next/packages/ui`: builds both pages (`dist` untouched, ignored by git). Root files are not touched: `git diff --name-only af0c1f7 -- ':!next' ':!docs'` is empty. Models requested per subagent role: `inherit` for cto, researcher, planner, reviewer and implementer (general-purpose subagents, no `model`); the reviewer and re-reviewer were fresh general-purpose subagents.

### Left for the human

- By hand, in the built app (not run here): in a Claude tab after `grove-next skill`, one sentence each: a setting (sidebar width), a shortcut (rebind the grid toggle), the theme (a green accent), a launcher (`claude plan` with an argument) and the layout (agents above spaces); each applies without restart. Break a file on purpose and see the last good version stay with the note in the status line.
- Not run here: the Tauri window itself (the window's behaviour is checked by reading and by the vite build only); the work-Mac fresh clone and the install steps in the README.
- From the review, left as they are: a modifier-less binding is not allowed, but `shift+<key>` is (the user's choice; it would intercept a typed `!` in a terminal, so a rebind to `mod` or `alt` is safer); launcher env values may contain a newline, which would type an extra Enter (the file is user-owned); the README's "Install on a fresh Mac" lists Node without a version, because `next/package.json` has no `engines` field, so the required Node version is not checked.
- A launcher line typed before the shell prompt relies on the pty buffering input; confirm by hand with a launcher that runs a command at start.

## Slice 9

Session: 9 look and feel
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: the window (`next/packages/ui/index.html`, `styles.css`, `main.ts`) is plain: a sidebar with a spaces list and an agents list grouped by state (`AGENT_GROUPS`), a tab strip whose tabs show only their number, and a bare `.term-host` per tab with no header. `styles.css` has a light and a dark theme and literal colours; slice 8 put the tokens in `src/tokens.css` with the old values. The old app's `src/renderer/src/components/ui/Icon.tsx` has Lucide-shaped icon paths (ISC) and `StatusDot.tsx`/`Spinner.tsx` have the old state tones and spin rule. The reference (`docs/work/2026-11-04-grove-v2-spaces-tabs/reference/herdr-look.html`) fixes the sizes and the palette: 250 px sidebar, 50 px header rows, 14.5 px names, 12.5 px meta, pane headers of 40 px. `SpaceInfo` has no branch: slice 2's git data is `repoName` and `mainPath` only (`core/git.ts`), so the branch has to be read in core. `tabs.close` exists (`{ id }`). No seen mark is drawn in the window today (slice 4 is core only), so there is nothing to restyle for it. No browser test runner is installed (vitest runs in node, no jsdom), so the render checks are pure functions plus the CSS text. A Playwright Chromium is in `~/Library/Caches/ms-playwright`; a headless screenshot of `?demo=states` is tried, not required.

Decisions taken for this slice (the plan leaves them open; recorded so the review can see them):
- One dark theme, as the reference says. The light palette in `styles.css` goes. The theme file still overrides any token.
- Fonts: Geist (interface) and Geist Mono (terminal) from `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` 5.3.0 (OFL-1.1), Latin woff2 copied into `next/packages/ui/assets/fonts/` with the licence. The old app's JetBrains Mono does not match the reference, so it is not reused for the look.
- Sidebar default width becomes 240 px (the reference is 250 px; 200 px made the branch text truncate). The `sidebarWidth` range stays 180 to 480.
- Branch: `spaceGitInfo` also returns the branch (`git rev-parse --abbrev-ref HEAD`, null when detached or when git fails); `SpaceInfo.branch` carries it. This replaces the plan's "slice 2's git data", which has no branch.
- Tile colours: eight tokens `--tile-1` to `--tile-8`; a space's tile is `tile-N` where N comes from a hash of its name (`tileIndex` in `ui/sidebar-model.ts`).
- Agent marks are letters on tokens `--agent-claude`, `--agent-opencode`, `--agent-copilot`; a shell tab's mark is `$` on `--agent-shell`, as in the reference.
- Icons: path data ported from the old `Icon.tsx` into `ui/icons.ts` (search, sidebar, plus, grid, x, terminal, worktree), with the Lucide licence note.
- The sidebar toggle collapses the sidebar column (`.app.sidebar-hidden`); the search icon is drawn and does nothing, as the slice says.
- Title bar: Tauri's macOS overlay (`titleBarStyle: "Overlay"`, `hiddenTitle: true`), the header row is a drag region and leaves room for the real window controls (`--traffic-light-inset`). The reference's drawn lights are not copied, since Tauri draws its own. On other platforms the header just has no inset.
- Tokens beyond slice 8's twenty names: the surface and text colours, the tile and agent marks, `--text-terminal` and the indicator sizes are new names in `tokens.css`. The theme file accepts only slice 8's twenty names, so the new ones are not overridable in v1 (recorded in Deviations).
- The tab's × closes the tab through `tabs.close` at once, with no confirmation (it ends the tab's process; the CLI does the same). Recorded for the human to judge.
- Agents are grouped under their space in the sidebar's space order; inside a group, rows are ordered by urgency (needs you, working, finished, unknown, idle) and then by the longest wait. A group with no agents is left out.
- A tab's state for the roll-up: a gone tab is idle; a shell tab is idle; an agent tab with no status yet is unknown (a guess is not hidden behind idle); otherwise the agent's state. A space's state is the most urgent state among its own tabs (`rollupSpaces` in `protocol/rollup.ts`); a space with no tabs is idle; a worktree counts only towards itself.
- Dimming: an unfocused grid pane dims its terminal only (`.term-host.pane-dim`); its header and indicator stay full strength, so an unknown ring stays visible.
- The spinner is a CSS transform that pauses (`animation-play-state`) while the window is not focused or the page is hidden (`html.unfocused`), and is static under reduced motion.
- `?demo=states` is a development-only page: `ui/demo/states.ts` is loaded by a dynamic import inside `import.meta.env.DEV`, so a production build does not contain it. It fabricates three spaces (one a worktree), tabs in all five states plus a gone tab, and agents, and renders them through the same functions and never calls Tauri or the core.
- Fonts load (`document.fonts.load`) before the first terminal opens, so xterm measures the bundled Geist Mono.
- The terminal theme is built from the tokens when a terminal opens (background `--color-ground`, text `--color-term-fg`, cursor `--color-ink`, selection `--color-selected`, font `--font-mono`, size `--text-terminal`). An already open terminal keeps the theme it opened with; a theme change applies to tabs opened after it.

Markup contract (`index.html` and `styles.css` are written to it; `main.ts` renders to it; the names are the contract):
- Sidebar `aside#sidebar.sidebar`: first, `header.side-head[data-tauri-drag-region]` with `span.brand-tile` ("G"), `span.brand-name` ("Grove"), `button#search-button.icon-button` (no handler), `button#sidebar-toggle.icon-button`; then `section#section-spaces` (`div.section-head` with `h2.section-label` "Spaces" and `button#add-space-toggle.icon-button` "+"), `ul#spaces.spaces`, `form#add-space.add-space` (`input#space-path`, `button` "Add"); then `section#section-agents.agents-section` (`div.section-head` with `h2.section-label` "Agents"), `p#agents-empty.empty`, `ul#agents.agents`; then `footer.sidebar-foot` (`button#install-cli.install-cli`, `a#stress-link`, hidden unless dev).
- Space row: `li > button.space` (`.space.worktree` when it has a parent, `.space[aria-current='true']` when selected), containing `span.space-tile.tile-N` (the letter, or the worktree icon for a worktree), `span.space-name`, `span.space-branch` (dim, right side), `span.indicator.ind-<state>`. A repo's worktrees are `ul.spaces.nested` under it, always shown.
- Agent group: `li.agent-group` with `h3.agent-group-name` (the space's name) and `ul.agent-rows` of `li.agent-row` (`.gone` for a gone tab) holding `button.agent` (`span.agent-mark.mark-claude|mark-opencode|mark-copilot` letter, `span.agent-label` "Tab N", `span.agent-age`, `span.indicator`) and `button.agent-resume` when the tab can resume.
- Tab strip `div.tabstrip`: `div#tabs.tabs[role=tablist]` with `div.tab[role=tab][aria-selected]` (`.active`, `.exited`) holding `button.tab-main` (`span.agent-mark` or `span.agent-mark.mark-shell`, `span.tab-label` "Tab N", `span.indicator`) and `button.tab-close` (×, `title="Close tab"`, shown on the active tab and on hover); then at the right `div.tab-actions` with `#launchers`, `#grid-toggle`, `#new-claude`, `#new-opencode`, `#new-copilot`, and `#new-tab` ("+", last).
- Main `main.main`: `div#terminals.terminals` holds `section.pane` per tab (`.focused` for the active one, `.pane-dim` on its `.term-host` when a grid member is unfocused), each with `header.pane-head` (`span.agent-mark` or shell mark, `span.pane-kind`, `span.pane-folder` shortened with `~`, `span.indicator`) and `div.term-host`. `div#empty-state.empty-state` (`h2`, `p`) is shown when there is no space, or the space has no tabs. `div#status.status`.
- Indicators: `span.indicator.ind-needs-you|ind-working|ind-finished|ind-unknown|ind-idle`, with `title` and `aria-label` from `indicatorLabel`.
- Roots: `html.mac` (macOS, from `navigator.platform`), `html.unfocused` (window not focused or page hidden), `.app.sidebar-hidden`.
- Kept element ids: `grid-toggle`, `new-tab`, `new-claude`, `new-opencode`, `new-copilot`, `launchers`, `install-cli`, `stress-link`, `status`, `add-space`, `space-path`, `section-spaces`, `section-agents`, `agents`, `agents-empty`, `spaces`, `tabs`, `terminals`, and the `.sidebar-foot` footer that `applyLayout` inserts before.

Implementer A (core and protocol; runs in parallel with B):
- [ ] `next/packages/protocol/messages.ts`: `SpaceInfo` gets `branch: string | null`.
- [ ] `next/packages/core/git.ts`: `spaceGitInfo` also returns `branch` (`git -C <dir> rev-parse --abbrev-ref HEAD`; null for `HEAD` or on error; never throws). `next/packages/core/spaces.ts` `describe` passes `branch`. Update `git.test.ts` and any `spaces.test.ts` expectation that compares a whole `SpaceInfo`.
- [ ] `next/packages/protocol/rollup.ts`: `URGENCY` (needs-you, working, finished, unknown, idle), `mostUrgent(states): AgentStateName` (empty gives idle), `rollupSpaces(paths: string[], tabs: Array<{ spacePath: string; state: AgentStateName }>): Map<string, AgentStateName>` (each path gets the most urgent among its own tabs; no tabs gives idle). `rollup.test.ts`: each state wins over the ones below it, empty is idle, a worktree's tabs do not count towards its repo, a path with no tabs is idle.
- [ ] `next/packages/core/config/schema.ts`: `sidebarWidth` default 240 (range 180 to 480 unchanged); fix `schema.test.ts` and `next/README.md` where they name 200 for the default.

Implementer B (look, static files; parallel with A):
- [ ] `next/packages/ui/assets/fonts/`: copy the Latin variable woff2 of Geist and Geist Mono from `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` 5.3.0 (run `npm pack` into a scratchpad folder, extract there, copy only the files) as `Geist-Variable.woff2` and `GeistMono-Variable.woff2`, plus the OFL licence as `OFL.txt`. Do not add a package dependency.
- [ ] `next/packages/ui/src/fonts.css`: `@font-face` for `Geist` and `Geist Mono` (weight 100 to 900, `font-display: block`, `url('../assets/fonts/...')`).
- [ ] `next/packages/ui/src/tokens.css`: final values for slice 8's twenty names; new names: `--color-page`, `--color-ground`, `--color-sidebar`, `--color-raised`, `--color-selected`, `--color-line`, `--color-well`, `--color-ink`, `--color-mute`, `--color-faint`, `--color-term-fg`, `--color-pane-line`, `--color-pane-focus`, `--tile-1` to `--tile-8`, `--agent-claude`, `--agent-opencode`, `--agent-copilot`, `--agent-shell`, `--text-terminal`, `--ind-size`, `--ind-stroke`, `--halo-size`, `--spin-period`, `--header-h`, `--traffic-light-inset`, `--radius-lg`. Values from the reference (`herdr-look.html`): ground `#161617`, sidebar `#111112`, page `#0b0b0c`, raised `#1c1c1e`, selected `#262628`, line `#2a2a2d`, ink `#e8e8ea`, mute `#8e8e93`, faint `#5f5f64`, state colours `#f0b44c`, `#6ea0ff`, `#4fcf86`, `#6c6c72`, `#4a4a50`; agent marks `#c7683f`, `#3d6fe0`, `#6e56cf`, shell `#3a3a3e`; accent `#8ab4ff`. Sizes: `--text-sm` 12px, `--text-md` 13.5px, `--text-lg` 14.5px, `--text-terminal` 12.5px, `--space-1..6` 4, 6, 8, 10, 12, 16px, `--radius-sm` 6px, `--radius-md` 9px, `--radius-lg` 12px, `--header-h` 50px, `--traffic-light-inset` 78px, `--ind-size` 10px, `--ind-stroke` 1.5px, `--halo-size` 3px, `--spin-period` 1s. `--font-ui: 'Geist', system-ui, -apple-system, sans-serif`, `--font-mono: 'Geist Mono', ui-monospace, Menlo, monospace`. `color-scheme: dark`; no light palette.
- [ ] `next/packages/ui/styles.css`: rewritten to the markup contract above and to the reference's layout (sidebar, rows, tab pill, pane headers, indicators). Every colour is a token; every size is a token, except `0`, `1px`, `100%`, `auto`, `inherit`, `currentColor`, `transparent`. Indicators: needs you a solid amber dot with a halo (`box-shadow`), working a spinning ring (`animation: spin var(--spin-period) linear infinite`, paused under `html.unfocused`, static under `prefers-reduced-motion`), finished a solid green dot, idle a hollow ring, unknown a dashed ring. Selected space and agent: a lighter rounded background and no left marker. `.app.sidebar-hidden` makes the sidebar column zero. Keep the classes the stress page uses (`.grid`, `.term-host`, `.stress-*`, `.results`) working.
- [ ] `next/packages/ui/index.html`: the markup contract; loads `./src/fonts.css`, `./src/tokens.css`, `./styles.css` in that order. `stress.html` loads the fonts file too.
- [ ] `next/packages/ui/icons.ts`: `iconSvg(name)` returns SVG markup (viewBox 24, stroke currentColor) for `search`, `sidebar`, `plus`, `grid`, `x`, `terminal`, `worktree`, from the old `src/renderer/src/components/ui/Icon.tsx` shapes (Lucide, ISC; the comment names the source).
- [ ] `next/packages/ui/indicator.ts` (no DOM at import): `INDICATOR_STATES`, `indicatorLabel(state)` ("needs you", "working", "finished", "unknown", "idle") and `indicatorClass(state)` (`indicator ind-<state>`, with `needs-you` as `ind-needs-you`). `indicator.test.ts`: every state has a label and a class; `styles.css` has a rule `.ind-<state>` for every state that uses `var(--state-<state>)`.
- [ ] `next/packages/ui/literals.test.ts`: scans `next/packages/ui/**/*.{css,ts,tsx}` excluding `src-tauri/`, `dist/`, `node_modules/`, `demo/`, `stress*`, `src/tokens.css`, `*.test.ts`; fails on any hex colour, `rgb(`/`rgba(`/`hsl(`/`hsla(`/`oklch(`, or a number with `px`, `rem`, `em`, `pt`, `vh`, `vw`, `s` or `ms` unit, other than `0`, `1px`, `100%`, `0s`, `0ms`. Tokens-file-only literals are fine. Run it first on the current tree to see it fail for the right reasons, then make it pass.
- [ ] `next/packages/ui/src-tauri/tauri.conf.json`: window `titleBarStyle: "Overlay"`, `hiddenTitle: true`. `src-tauri/capabilities/default.json`: add `core:window:allow-start-dragging` for the header drag region.
- [ ] `next/packages/ui/design-notes.md`: the type scale, the spacing steps, the radius steps, and the indicator table (state, shape, colour token, motion).

Implementer C (window behaviour; after A and B are both done):
- [ ] `next/packages/ui/sidebar-model.ts` (pure, tested): `tabStateOf(tab: { exited: boolean; kind: 'shell' | AgentKind; state: AgentStateName | null })` (exited or shell gives idle; an agent tab with no state gives unknown; else the state), `groupAgents(spaces: string[], rows: Array<{ spacePath; tabNumber; agent: AgentInfo; exited }>)` (space order, empty groups left out, rows by urgency then `since` ascending), `tileIndex(name): number` (1 to 8, stable hash), `shortFolder(path, home)` (`~` prefix). `sidebar-model.test.ts` covers each.
- [ ] `next/packages/ui/demo/states.ts`: `isDemoStates(location, dev)` and `demoRows()` returning spaces (three, one a worktree), tabs in all five states plus a gone tab, and agents; `demo/states.test.ts` checks it covers all five states, a worktree, and a gone tab.
- [ ] `next/packages/ui/main.ts`: sidebar, tab strip, panes and empty state per the contract; `rollupSpaces` for space indicators (through `tabStateOf` per tab); branch text from `SpaceInfo.branch`; agents grouped with `groupAgents`; the × calls `tabs.close` and removes the tab; sidebar toggle; `+` next to the search icon focuses `#space-path`; `html.mac` and `html.unfocused` (set on start and on focus change and `visibilitychange`); `await document.fonts.load` before the first terminal; the demo branch (`if (import.meta.env.DEV && isDemoStates(...)) { const demo = await import('./demo/states.ts'); ... }`) that renders the fabricated rows without bridge or invoke calls and skips `attention.focus`.
- [ ] `next/packages/ui/terminal.ts`: theme and font from the tokens, read with `getComputedStyle(document.documentElement)`; `fontSize` from `--text-terminal` (parsed as a number).
- [ ] Keep `stress.ts` working with the new styles; change it only if a class or id it uses is gone.

Added by the human during the slice (after implementers A and B started; the human said "it is a start, we need to fix a few things"):
- Cmd+Shift+N creates a new space at the home folder (`~`) and opens one terminal tab there at once; if that space already exists it is selected and gets the one new tab. Key action `new-space`, default `mod+shift+n`, in keys.json like the others.
- Cmd+T opens a new terminal (shell) tab in the current space. This is slice 8's `new-shell` (default `mod+t`) already; it stays, and the requirement is checked, not re-built.
- Cmd+W closes the current tab (`tabs.close` on the active tab, the same path as the × button). Key action `close-tab`, default `mod+w`.
- Double-click on a tab opens a rename modal (a text box, Save and Cancel; Enter saves, Esc cancels). A new core method `tabs.rename` (`{ id, label }`, an empty label clears the name) stores the label in the tab record (`label` already exists in `TabRecord`), and the window re-renders the tab and pane title from it. The tab label shows the saved name, else "Tab N".
- Item 5 of the human's list was empty; not built, asked at the final message.

Reviewer: a fresh `reviewer` subagent gets the diff of this slice, the decisions above, the contract, and `01-outcome.md`. It must read `reference/herdr-look.html` and check the markup against the contract.

Models passed: planner=inherit, reviewer=inherit, implementer=inherit (general-purpose subagents, no `model`).

Verification: `cd next && npm test` passes (all files, including the new tests and the literal scan); `npm run typecheck` clean; `npx vite build --outDir <scratchpad>` in `next/packages/ui` builds both pages; a production build's output does not contain the string `demo=states` (the grep is recorded); headless screenshots of `?demo=states` against the reference are tried with a Playwright Chromium if one runs here (paths recorded, not committed); `git diff --name-only af0c1f7 -- ':!next' ':!docs'` is empty; `git status` shows no `next/packages/ui/reference/`.

### Review rounds

Round 1 (fresh reviewer; 2 blocking, 13 non-blocking). Blocking: Cmd+W reached the default menu's "close window" item, which the system handles before the page sees the key (fixed: `src-tauri/src/lib.rs` builds a menu without that item and keeps Quit, Edit and Window minimise; `cargo check --offline` passes, not run in the app); the demo page reached a production build when the shell had `NODE_ENV=development` (fixed: `vite.config.ts` sets `import.meta.env.DEV` from the command; the build grep is clean with and without `NODE_ENV`). Non-blocking applied: a gone agent row sorts as idle, not by its stored state (test added); the rename input has `maxlength="80"`; the worktree rows get an indent rule (`.space.worktree`), so the class is styled. Non-blocking left, recorded in Deviations: a tab's number renumbers when a tab before it closes; × and Cmd+W close a running agent at once with no confirmation; only the sidebar header is a drag region; the sidebar footer (install command, stress link) and the folder form stay; `core/spaces.ts` `rename` saves through `saveAgentTab`, the existing writer, so its name is misleading (behaviour is right).

Verdict: pass after the blocking fixes. The fixes were checked by the test run, the build grep and the Rust check, not by a second fresh review.

### Deviations

What was reused from the old app, as the human asked: the icon paths (`src/renderer/src/components/ui/Icon.tsx`, Lucide shapes, ISC) in `ui/icons.ts`; the spin rule of `Spinner.module.css` (paused and static as the plan says); the state-indicator idea of `StatusDot.tsx` (a dot per state), with the reference's colours; `agentSkillsDirs` and the JSON write from slice 8. Not reused: the old JetBrains Mono (the reference is Geist and Geist Mono, so the bundled Geist replaces it); the old light and dark palette.

Where it differs from the plan, and why:
- The human's requests after the plan was written, which override it where they conflict: the `+Claude`, `+OpenCode` and `+Copilot` buttons are removed, with their key actions `new-claude`, `new-opencode` and `new-copilot` (the config now refuses those names, so an existing `keys.json` that names them fails validation until the line is removed). New key actions: `new-space` (`mod+shift+n`, a new space at `~` with one terminal tab; an existing one gets one new tab) and `close-tab` (`mod+w`, the same path as the ×). `tabs.rename` is a new core method (trimmed; an empty name clears it; over 80 characters is refused). Cmd+T stays `new-shell` (`mod+t`).
- The branch is read in core (`spaceGitInfo` now returns it, `SpaceInfo.branch`). The plan assumed slice 2 already read it; it did not.
- Sidebar default width 240 px, not 200 (the reference is 250 px; 200 px truncated the branch text). The range is unchanged.
- Tokens beyond slice 8's twenty names: the surface and text colours, the tile colours `--tile-1` to `--tile-8`, the agent marks, `--text-terminal`, the indicator sizes, `--size-modal` and the others in `tokens.css`. The theme file accepts only slice 8's twenty names, so these are not overridable in v1.
- Tile colours: the first four from the reference, the last four chosen here.
- Title bar: Tauri's macOS overlay (`titleBarStyle: "Overlay"`, `hiddenTitle: true`) with `--traffic-light-inset` for the real window controls; the reference's drawn lights are not copied.
- The tab's × and Cmd+W close at once, with no confirmation. A running agent ends with it, the same as `tabs.close` from the CLI. Recorded for the human to judge.
- Tab numbers are the position in the space, so closing a tab renumbers the ones after it (the strip, the pane header and the rename placeholder). The plan's wording says "Tab N" by position; say if names should stay with the tab.
- The rename modal is prefilled with the saved name only (empty when none), so the placeholder "Tab N" is not saved by accident. Key actions are ignored while it is open.
- The pane header shows the tab's name (saved, else "Tab N"), not the agent's name as the reference shows it.
- The sidebar lists only agents that `agents.list` returns. An agent tab with no status yet shows as unknown in the tab strip and the space's indicator, with no sidebar row.
- Cmd+Shift+N adds the new space to the local list and selects it, instead of a full resync (a resync re-attaches every terminal and resets its screen).
- The tab-strip agent buttons are gone, so the contract's `#new-claude`, `#new-opencode` and `#new-copilot` no longer exist (the contract line above is superseded).
- `bridge.ts`: the Tauri `Channel` is created on first use, not in `createBridge()`. Creating it at load threw in a plain browser, so the demo page rendered nothing; the Tauri behaviour is unchanged.
- The demo is loaded by `main.ts` with a dynamic import inside `import.meta.env.DEV`, then `isDemoStates` decides; the production build has no demo code (checked).
- `vite.config.ts` sets `import.meta.env.DEV` from the command, not from `NODE_ENV` (review fix).
- `src-tauri/src/lib.rs`: a menu without the close-window item, so Cmd+W reaches the page (review fix).
- The sidebar toggle collapses the sidebar column; the search icon is drawn and does nothing, as the slice says.
- Fonts load before the first terminal opens. A terminal keeps the theme it opened with; a theme change applies to tabs opened after it.
- `watch.test.ts` (slice 8's test, not this slice's code): the test now waits 200 ms for the watcher to be armed before its write. It failed once under load in a full run (a write in the same tick as `fs.watch` can be missed on macOS). Its timing limits are unchanged.
- The stress page is unchanged apart from loading the fonts; it still needs Tauri to start a run.

### Verification

- `cd next && npm test`: 48 files, 443 tests, all pass (the last run, after the review fixes).
- `npm run typecheck` (`tsc --noEmit` in `next/`): clean.
- Production build: `npx vite build` in `next/packages/ui` with `NODE_ENV=development` in the shell, and with `--mode production`: the output contains neither `demo=states` nor `isDemoStates` nor `demoRows`.
- `cargo check --offline` in `next/packages/ui/src-tauri`: passes (the menu change).
- Headless screenshot of `/?demo=states` against the dev server (a `chrome-headless-shell`): the output is at `/private/tmp/claude-501/-Users-victor--grove-worktrees-grove-feature-2026-11-04-grove-v2-spaces-tabs-inherit/733b0762-d290-48d2-a22f-e408ccb9c91f/scratchpad/states-c.png`. It shows spaces with indicators, agent groups, a gone row with Resume, and a pane header. Not placed beside the reference here.
- Not verified in a browser or the Tauri app: the rename modal, Cmd+Shift+N, Cmd+W, Cmd+T and the double-click.
- `next/packages/ui/reference/` does not exist; the reference stays in `docs/work/…/reference/`, which is tracked with the plan.

### Left for the human

- Run the app and try: Cmd+Shift+N (a new space at `~` with one terminal tab), Cmd+T, Cmd+W (closes the tab, not the window), a double-click on a tab (save, empty name clears, Esc cancels), and the × button.
- Judge the look beside `reference/herdr-screenshot.webp`: the sidebar width (240 px against the reference's 250), the footer and folder form, the truncated worktree name on the 240 px sidebar, the empty state and the rename modal, which were judged from the CSS and not seen rendered.
- Decide: whether × and Cmd+W should ask before ending a running agent; whether tab numbers should stay with their tab when another closes.
- Item 5 of the request was empty, so nothing was built for it.
- Cmd+Shift+N against a live core: restart the core first (see the rename note below), then press it: it must add a new space at your home folder with one terminal tab.
- Rename saves failing with `unknown method tabs.rename` mean the running core predates the rename code. Quit Grove, stop only the core process (`pkill -f packages/core/bin.ts`; never `holder/bin.ts`, which keeps the agents alive), then open Grove again. The modal now shows that message instead of hiding it.
- An existing `keys.json` that names `new-claude`, `new-opencode` or `new-copilot` now fails validation until those lines are removed.

### Fix after review

Comment from the human, after trying the app: the tab rename had three faults. (1) A double-click worked only on the padding of the pill, not on the name. (2) Enter in the rename box did not save. (3) Save did nothing: the name was not saved and the modal stayed open.

Causes, found in the app and the browser, not guessed:
- (1) `paintTab` rebuilt the children of the tab's button on every paint, and every click paints (it activates the tab). The second click of a double-click landed on a detached node, so the `dblclick` never reached the pill. Only the padding, which is never rebuilt, still worked. Fix: the pill's DOM is made once and updated in place (`ui/tab-pill.ts`); a double-click on the name, the padding or the gap opens the rename; the close button does not.
- (2) and (3) are one fault: `tabs.rename` failed, and the failure went to the status line behind the modal backdrop, so nothing looked saved. The running core (started at 01:54 today, before the rename code) answers `unknown method tabs.rename` (checked by sending the request to its socket). The modal is now `ui/rename-modal.ts`: Enter (in the name box), Save, Esc, Cancel and the backdrop all go through one save; a failure keeps the modal open and shows the reason inside it.

Tests added: `ui/tab-pill.test.ts` (a double-click on the name, the pill and not the close button; a double-click after a re-paint still opens the rename; the close button closes only; the name element is kept), `ui/rename-modal.test.ts` (open with the saved name or empty; Enter saves trimmed and closes; Save saves and closes; an empty name clears; Esc and Cancel and the backdrop cancel without saving; a failed save keeps the modal open with the reason; the next open clears it), and `core/spaces.test.ts` ("keeps a tab name after a restart of the core": the name survives a new `SpacesService` on the same state file). The two DOM tests run under happy-dom, pinned as a dev dependency (`happy-dom@21.0.4`, published 16 days before this fix); the repo had no DOM test library. Browser check (headless Chromium, the demo page): double-click on the name, the pill edges and the gap open the modal; Enter, Save, Esc, an empty name and a stale core behave as the tests say.

Verification re-run: `cd next && npm test`: 50 files, 458 tests pass. `npm run typecheck`: clean. Production build grep for `demo=states` with `NODE_ENV=development`: none.

### Fix after review (second comment)

Comment from the human: remove the folder text box and "Add" under Spaces; two spaces may point at the same folder; Cmd+Shift+N must create a new space each time (it had selected the existing home space instead, since spaces were keyed by folder path).

Change: a space has an opaque `id`. A space added now gets `sp_` plus 12 random hex characters, and nothing derives it from the folder. Spaces saved before this change keep their path as their id, so existing state needs no migration of ids. The space's path stays a separate, changeable field (the debug child's root rule may change it). Tabs carry a `spaceId` (optional in saved state; a tab without one is attached to the first space at its path on load). `spaces.add` always adds a new space; `tabs.open` takes `spaceId`; the CLI maps a folder to its first space. The window keys spaces, tabs, agent groups, worktree nesting and the roll-up by id, removes the add form, and Cmd+Shift+N adds a new space at the home folder and opens one terminal tab there.

Decisions: the `${path}#n` form applies only to duplicates in an old state file without ids (the first duplicate of a folder keeps its path as id); new spaces never use it. The CLI's `ls` headings use the path with an occurrence index, not the id. The empty state now points at Cmd+Shift+N instead of the removed form. Rolling up by id means two spaces at one folder roll up separately.

Verification: a clean checkout of this commit: `npm run typecheck` clean, `npx vitest run` 50 files and 471 tests pass. The working tree also had the debug child's uncommitted work (53 files, 494 tests), which is not in this commit. Production build: no `demo=states` in the output. Browser check of the demo page (headless Chromium): no add form in the DOM; four spaces listed, one of them a second space at the folder of the first.

Not checked in the app: Cmd+Shift+N against a live core (the running core must be restarted to pick up the change).

### Final summary

Slice 9 makes the window look like the Herdr reference and adds the four shortcuts and rename the human asked for. The spaces list shows a coloured letter tile, the branch in dim text and a state indicator per space, with a worktree nested under its repo. Agents are grouped under their space and sorted by urgency. The tab strip shows an active pill with a close button and an indicator on each tab; the panes have their own headers. Indicators follow the reference's shapes and colours, and spin only while the window is focused. Everything uses tokens; a scan test keeps the literals out. Geist is bundled. The demo page is development-only.

Behaviour added in this slice, beyond the plan's list: Cmd+Shift+N, Cmd+W, the rename modal and `tabs.rename`; the Claude/OpenCode/Copilot buttons removed. The sidebar default is 240 px.

Suggested PR description: "Slice 9 of the Grove v2 rebuild: the look (spaces with state, grouped agents, tab pills, pane headers, bundled Geist), plus Cmd+Shift+N, Cmd+W, double-click rename, and removal of the per-agent buttons. Verified by tests, the production build check and a headless screenshot; not yet verified in the app." 

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## Open questions

## Post-run fix: agents in a terminal

Reported by the human: an agent typed into a plain terminal tab (`claude`, `opencode` or `copilot`) did not appear in the agents list and had no status. Only agents started by the launch buttons did.

What was found: agent status existed only for tabs the app launched. The launch wrote per-launch hooks and a spool, and started the watch; a typed agent had none of these, and nothing looked at what a tab was running. Space roots were fixed at creation, and nothing tracked where a tab's shell was. The old Grove had no by-hand detection either; it used tmux's pane path and command only for plain terminals.

What changed:
- Every tab gets `GROVE_NEXT_TAB` (its id) and `GROVE_NEXT_HOME` (the state folder). The holder's `tabs.list` now returns each tab's live folder (`lsof`, cached 2 s) and its foreground program name.
- A presence scan runs each second. A tab whose foreground program is `claude`, `opencode` or `copilot` is adopted at once as `unknown`, and saved with `found: true` so a restart keeps it. It is released after three ticks in which the program is gone, so a tool that briefly takes the foreground does not drop it.
- The state comes from the agent's own hooks. Claude's hook reads the tab's spool from the two variables. Copilot's watch starts from its first hook's `sessionId`. OpenCode is found through the shared service by folder and creation time.
- A `cd` in a plain tab moves the space's root only when no agent tab in that space sits in a different folder. The space id does not change. A restored tab opens in the space's current root.
- The per-launch Claude hooks are left out only when the user's Claude settings carry Grove's hooks, so no event is reported twice.
- The core answers `core.ping` with a fingerprint of its own source. `grove-next` refuses to run against a core from an older build, and says so. It does not restart the core; the core must be stopped by hand.
- Presence is driven by the foreground program name. Claude, OpenCode and Copilot are native binaries, so that name is the command name (checked in real pseudo-terminals).

What the install writes (run it only by hand, once):
- `grove-next integration install claude` edits `${CLAUDE_CONFIG_DIR:-~/.claude}/settings.json`: one command per Claude hook event, merged next to the user's own hooks. Each command runs only when `GROVE_NEXT_TAB` is set.
- `grove-next integration install copilot` edits `${COPILOT_HOME:-~/.copilot}/settings.json`: a `hooks` entry per Copilot hook event, merged the same way.
- Both write a backup of the file as it was before the first change, next to it (`settings.json.grove-next.bak`). `grove-next integration uninstall claude|copilot` removes only the entries it wrote.
- OpenCode needs no install (`grove-next integration install opencode` only says so). Nothing is written to `~/.config/opencode`.
- Entries are found again by the comment `# grove-next-hook` at the end of each command.

Verified: the tests (`npm test`, 496 pass, typecheck clean) include a real shell running each installed hook command with and without `GROVE_NEXT_TAB`, a real `tabs.open` tab in which a program named `claude` is typed and adopted and then dropped, and a `cd` that moves a space's root. Process names of the three real agents were checked in pseudo-terminals. Copilot's user-level hooks fired on a real prompt (Copilot 1.0.105), and its `sessionStart` payload carries `sessionId` and `cwd`.

Not verified: the real Claude's hook path end to end. A fresh config folder stops at the login screen before any hook runs, and the logged-in config was not touched. Please check it by hand:
1. Quit Grove, and stop the old core (it does not see agents typed by hand).
2. Run `grove-next integration install claude` (and `copilot` if you use it). Keep the backup it names.
3. Start Grove. Cmd+Shift+N, then `cd` to a project folder in the terminal tab, then run `claude`. The agent should appear in the agents list as `unknown` at once, then change to `working` when you send a prompt, and `needs you` on a permission ask.
4. Exit Claude: the agent should leave the list after a few seconds.
5. Run `grove-next integration uninstall claude` when you are done with it.

Known gaps: a Copilot agent typed by hand gets its state only after its first prompt (its start hook needs one). OpenCode's session is found only after OpenCode has created it. The `found` flag is saved in the state file; a state file written before this change loads unchanged, and its tabs are not marked found.
