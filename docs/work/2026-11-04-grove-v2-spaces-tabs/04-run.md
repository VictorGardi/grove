---
feature: 2026-11-04-grove-v2-spaces-tabs
phase: run
status: draft
version: 1
created: 2026-11-04
updated: 2026-11-04
approved_at:
based_on: [03-plan.md@8]
forced: []
---

# Run: Grove rebuilt around spaces and tabs

Profile: inherit
Branch: feature/2026-11-04-grove-v2-spaces-tabs-inherit
Plan commit: 3aa8c056635901c19b24d567d427cb8cf4037754
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

## Open questions

## Open questions
