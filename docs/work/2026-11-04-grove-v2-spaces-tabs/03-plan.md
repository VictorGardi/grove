---
feature: 2026-11-04-grove-v2-spaces-tabs
phase: plan
status: approved
version: 8
created: 2026-11-04
updated: 2026-11-04
approved_at: 2026-11-04
based_on: [01-outcome.md@1, 02-research.md@2]
forced: []
---

# Plan: Grove rebuilt around spaces and tabs

## Decisions

### D1. Language and shape of the app

**Context.** You asked whether to stay on Electron or move to Rust, and you want the window separated from the part that runs the agents. This is the choice everything else sits on, and it is expensive to reverse. The research has no measurements showing that Grove's current stack is slow, so the choice rests on what must be installed, what the nine-pane grid needs, and how easily an agent can change the app.

**Options.**
- A. TypeScript everywhere: a core daemon and a small holder in Node, the window in Electron (web UI). Pros: nothing new to install on the work Mac, since by your answer you run Grove from source there today and Node and the node-pty build work through `npm run dev`; the grid runs on xterm.js in Chromium, the same engine on every Mac (nine and sixteen panes ran without context loss in the spike); themes and layout are CSS and JSON that an agent can edit; working agent adapters from the current code can be ported. Cons: Electron uses more memory and disk than a native app and will not feel as native as Herdr; a later Rust core is extra work, though D5 keeps the door open; in the spike the Electron app this repository has was 288 MB against 10 MiB for Tauri, and Tauri used 21 to 41 percent less memory for the same nine panes.
- B. Rust core and holder, Electron window. Pros: a small, sturdy daemon, the same split as Herdr. Cons: a Rust toolchain (or shipped binaries) on both Macs; two languages; the Rust PTY crate `portable-pty` has had no release in about 21 months and the terminal-parsing bindings are pre-1.0 and need Zig; slower to a first usable version.
- C. Tauri window with the Node core and holder kept as in A. Pros (measured in Spike S0 on the personal Mac): the web UI and xterm.js code stay the same; all nine, and also sixteen, WebGL terminals ran without context loss; key echo and data lag were within the bars; the app is about 29 times smaller (10 MiB against the 288 MB Electron app this repository already has) and the window's processes used 21 to 41 percent less memory (the Node holder excluded; the low end comes from a run where the Electron window was reported hidden); Tauri's Rust side reached the core's socket, started the holder detached (it survived the app quitting) and relayed raw bytes without loss. Cons: a Rust toolchain on top of Node on both Macs (already on the personal Mac, not tested on the work Mac); two multi-second render stalls in 2 of 8 nine-pane runs with an unknown cause (none in the last five); notifications showed only from the built app bundle; the window can no longer reach the socket or start the holder by itself, so Rust must do both (about 90 lines in the spike, covering the bridge, holder start and notifications); no runtime plugin loading is documented.
- D. Tauri with a Rust core and holder. Pros: the fewest runtimes at the end (no Node). Cons: B's costs plus C's; not spiked.
- E. Fully native Rust with GPUI, like Herdr. Pros: Herdr's look and feel and a single language. Cons: GPUI is pre-1.0 with breaking changes (Herdr itself patches and vendors it), no terminal widget ships with it, the largest build by far, and changing the UI needs a rebuild unless a script runtime is embedded.

**Pick:** C

**Status.** Chosen by you after Spike S0 (findings in `02-research.md` under `## Spikes`). It stays subject to the work-Mac gate in slice 1 (the rule is stated there): if it fails, D1 reverts to A and the window parts done in Electron form come before slice 2.

**Outcome impact.** On both Macs you need Node, the Xcode command line tools and Rust, and `npm run dev` runs the window with `tauri dev` from source (the spike's cold release build took 60 seconds and later release rebuilds about 10; a debug `tauri dev` build was not timed). You get a much smaller and lighter window on the system web view, and you take on a small Rust bridge and an unexplained stall risk that slice 1 re-checks on both Macs.

### D2. Who owns the terminals

**Context.** Today tmux keeps agents alive when the app quits. You want agents to survive a closed window or a crash, an agent that is editing Grove must survive Grove restarting, and you want fewer things to install. Someone has to own the PTYs, remember the screen so a reattach looks right, and keep running when the rest restarts.

**Options.**
- A. Keep tmux. Pros: proven; no new survival code. Cons: another install on every machine; Grove attaches through a tmux client per pane and does not hold the screen itself, which makes exact repaint and a status cross-check from the terminal harder.
- B. Our own two processes in TypeScript: a tiny holder that owns the PTYs and rarely changes, and the core, which keeps a headless screen per terminal for repaint and can be restarted or upgraded while agents keep running. Pros: no tmux; the core restarts freely; the same split Herdr uses. Cons: we own reattach fidelity (alternate screen, scrollback, resize); whether `@xterm/headless` with its serialize add-on is good enough was not verified, so slice 1 proves it; a bug in the holder takes agents down with it.
- C. Adopt `herdr-core` (Apache-2.0) as the daemon and write only the window and the agent adapters. Pros: the holder, screen model, status protocol and remote machines already exist, so far less to build. Cons: it is a 0.1.x project with eight releases in twelve days, so the API will move; it is a Rust binary to obtain or build on both Macs (whether prebuilt binaries exist was not verified); core behaviour is controlled by upstream, which fights "an agent changes my app"; it ties Grove to another project's direction.
- D. Our own holder and core in Rust. Pros: a single static daemon that does not need Node (general knowledge). Cons: as D1 option B.

**Pick:** B. C is the strongest alternative, and the one that would shrink the work most.

**Outcome impact.** No tmux on either Mac. Quitting or crashing the window never touches agents, and restarting the core does not either. If the holder itself dies, its agents die; that is the new risk you accept. Upgrading the holder itself (a protocol change) means restarting everything, which ends every agent.

### D3. What "status" means, and how it is produced

**Context.** The sidebar is only worth trusting if every agent reports the same few states, and if the app says "unknown" rather than guessing. Today's three adapters admit gaps (an Esc-rejected question and an interrupt fire no Claude hook, a turn woken by a background task has no prompt hook, Copilot write paths are unverified). The states and their meaning are what the sidebar, notifications and the command line all build on, so they must be fixed early.

**Options.**
- A. One neutral status record that every adapter must produce: state (`working`, `needs-you` with a reason of permission, question or error, `finished` until seen, `idle`, `unknown`), since when, and where it came from. Each adapter uses its agent's own upstream signals (Claude hooks, the OpenCode event stream including its `form.*` events as today's adapter does, Copilot hooks and event log). Two rules keep it honest. First, a source that goes silent (the spool reader, the event connection) turns its tabs `unknown`. Second, the holder's view of the terminal is a cross-check. When a `needs-you` is raised, the core remembers what the visible screen looks like a few seconds later (ignoring the cursor and spinners). If the visible text then changes in any real way, for example the dialog disappears after an Esc even if the screen goes quiet again, the state falls back to `unknown` until the next real event. A `working` whose terminal has been silent for longer than a threshold also falls to `unknown`. Thresholds are settings (the grace is about 3 seconds, the silence about 30). Tests replay recorded real event captures per agent and inject the clock. Pros: one contract; honest unknowns; the Esc-rejected and interrupted cases fall to `unknown` instead of staying wrong; tests catch regressions. Cons: three adapters to keep up; in the gap cases a state can be wrong until the screen check fires (a few seconds for a dismissed prompt, up to the silence threshold for a quiet `working`); a long, quiet tool run can show a false `unknown`; moving the selection inside a permission dialog can look like a change and show a false `unknown` (the comparison ignores the selection marker where it can); the remembered screen is lost when the core restarts, so after a restart an Esc-rejected question is only caught at the next event; the research found no documented question signal for Copilot.
- B. Make Herdr's in-terminal status sequence (OSC 7501) the one path. Pros: one agent-neutral path, and no per-agent parsing if the agents did emit it. Cons: no agent integration for it was found for Claude, OpenCode or Copilot (not found, not proven absent); a hook runs outside the terminal, so getting its output into the stream is unverified; parsing the stream adds its own fragility.
- C. Infer status from the screen, with a model to judge. Pros: no adapters to maintain. Cons: in my view wrong in exactly the cases that matter and slow; it is the part of today's design you want gone.

**Pick:** A.

**Outcome impact.** You see crisp states for Claude from slice 3 and the same contract for OpenCode and Copilot. Where an agent gives no reliable signal you see "unknown", not a confident wrong answer, and the worst case in the known gaps is bounded by the screen check or the silence threshold (about 30 seconds).

### D4. The data model

**Context.** Today's model has Project, Session, links, feature fields, workflow status and dead keys from removed features (11 schema versions). You asked for it to be as simple as possible.

**Options.**
- A. A space is a directory (its identity is its real path). A tab is a terminal or agent session in a space. A worktree is just a space, and which repo it belongs to is worked out from git at load, never stored. Only spaces, tabs (id, kind, label, agent session id), their order and the layout are saved, in one versioned JSON file with atomic writes. Status, branch and PR are live only. Pros: tiny, matches how you think, nothing to migrate or carry. Cons: no parent and child between tabs; an agent that starts another through the command line gives a sibling tab. A version and migration discipline must be kept from day one.
- B. SQLite. Pros: queries and history. Cons: a native dependency, overkill for tens of records, harder for an agent to read or edit.
- C. Keep Project and Session with new names. Pros: familiar, nothing new to learn. Cons: carries the link kinds, feature fields and workflow status that are non-goals.

**Pick:** A.

**Outcome impact.** The sidebar shows spaces and tabs and nothing else. Anything a parent-and-child tree gave you before comes back later, if at all, as a label.

### D5. How the window, the command line and agents talk to the core

**Context.** You want the window separated from the core, and agents must be able to list, start and drive tabs. Whatever this boundary is becomes the app's public surface.

**Options.**
- A. JSON-RPC over a unix socket in a private folder (mode 0700), with a published versioned schema: one control channel (requests, plus events that start with a snapshot and a sequence number) and one data stream per attached terminal. The window, the command line and the adapters are all clients. Pros: any part can be rewritten in another language later; one surface to describe to agents; Herdr uses the same shape. Cons: the window's web page cannot open a unix socket (general knowledge), so Tauri's Rust side bridges (measured working in the spike, raw bytes through a Tauri channel without loss); we maintain the schema; any process running as you can drive the core, as with today's command socket.
- B. HTTP and WebSocket on localhost. Pros: a browser UI could connect directly. Cons: a port to guard and collide, and a local-access question the socket's file permissions answer for free.
- C. The window toolkit's own IPC for the window and a separate protocol for the command line. Pros: simplest for the window alone. Cons: two surfaces, and the window stays tied to the core.

**Pick:** A.

**Outcome impact.** The `grove-next` command and the window see exactly the same truth, and an agent in one tab can drive another through the same calls the window uses.

### D6. How "change the app with one sentence" works in v1

**Context.** You chose small changes (settings, shortcuts, themes, launchers, layout) applied live, with room to add code add-ons later. An agent in an ordinary tab has to find out how to do it.

**Options.**
- A. A config folder of files, each with a schema: settings, keys, launchers, theme tokens and layout. In v1, "launcher look" means a launcher's label, icon, arguments and environment, and "layout" means sidebar width and side, the order of the spaces and agents lists, and grid defaults. The app regenerates an `AGENTS.md` in that folder on every start that describes the files and their rules. Every tab Grove starts gets the folder's path in an environment variable, `grove-next config path` prints it, and `grove-next skill` installs a short skill for Claude (verified in v1) and best-effort instruction snippets for OpenCode and Copilot (how they load them was not verified in the research); each is written to apply only when `GROVE_NEXT_CONFIG` is set, so the old Grove's sessions are not affected, and says to read that `AGENTS.md` before changing Grove. Saving a file reloads it live; an invalid file keeps the last good version and shows a note naming the problem. Later add-ons are separate clients of the D5 protocol or web modules named in the layout file. Pros: any agent can do it from one sentence with the skill installed; fits the calm goal; Herdr uses the same idea. Cons: files are trusted input; a layout schema we get wrong has to be versioned; the agent must have the skill or snippet installed once.
- B. A settings screen only. Pros: simple and easy to find. Cons: cannot be driven by a sentence.
- C. A full add-on runtime now. Pros: anything is possible from the start. Cons: you deferred it; large; needs a security model.

**Pick:** A.

**Outcome impact.** After a one-time `grove-next skill`, telling an agent "make the sidebar wider and use a green accent" works in v1. A new panel such as an editor does not, until add-ons arrive.

### D7. Where the code lives and how it coexists with the old Grove

**Context.** The old Grove must stay untouched and running, and skills and agents call a command named `grove` today. The plan itself is built from this repository by `grove-run`.

**Options.**
- A. New code in a `next/` workspace in this repository that is not part of the root workspaces or the root test glob, with its own data folder (`~/.grove-next`), socket (`grove-next.sock`), app id, environment names (`GROVE_NEXT_SESSION_ID`, `GROVE_NEXT_SOCKET`) and command (`grove-next`) until the cutover, when names are swapped. Pros: the old app, its build and its tests are untouched; this repository's docs, decisions and run flow keep working; the new names mean an agent in one app cannot drive the other by accident. Cons: two similarly named apps for a while; skills that call `grove` keep driving the old app until the cutover; the cutover rename of the data folder must not merge with the old `~/.grove` data; the root workspace and test settings were not read in the research, so slice 2 verifies that the old tests are unaffected.
- B. A new repository. Pros: a clean history. Cons: the plan, the docs and `grove-run` live here; work spans two repositories.
- C. Replace in place. Pros: one app, nothing duplicated. Cons: breaks "old Grove untouched".

**Pick:** A.

**Outcome impact.** You can run both apps side by side from day one, with nothing shared between them.

### D8. Who starts and keeps the core and holder running

**Context.** Closing the window must leave agents running, and `grove-next space add` from a terminal must work when the window is closed. Something has to start the holder and core, restart the core if it crashes, and say which Node runs them. The spike showed that a holder started detached by the window's Rust side survives the app quitting.

**Options.**
- A. On demand and detached: the first client (the window or the command) starts the holder, in its own session with no terminal, if it is not running. The holder starts and watches the core and restarts it after a crash with a growing delay (the way Herdr's holder does). Nothing starts at login. They run under the system Node, the same Node that `npm install` builds node-pty for; the Tauri window is only the UI and never loads node-pty. Version 1 runs from source on both Macs, as today; a packaged app is not part of v1. The window's Rust side starts the holder detached with the Node path that `npm run dev` records in an environment variable, and the `grove-next` script starts it the same way with its own Node path, so a version manager's PATH does not matter. Pros: nothing is installed in the system; works the same in development; the command and the window share one start path. Cons: after a reboot nothing runs until you open the app or run the command; nothing watches the holder.
- B. A launchd agent that starts at login. Pros: always running, restarted by macOS. Cons: installs a persistent login item on both Macs, which is invasive and hard to use in development.
- C. Children of the window app (for example Tauri sidecars). Pros: no detached processes to manage. Cons: they probably stop when the app quits, which defeats the goal (not tested).

**Pick:** A.

**Outcome impact.** Agents outlive the window and a core crash. After a reboot you get your spaces and tabs back the first time you open the app or run the command.

## Slices

### Spike S0. Tauri versus Electron for the window (done, before slice 1, not a slice)

**Status.** Run on 2026-11-04 on the personal Mac with `grove-spike`; the findings are in `02-research.md` under `## Spikes` and the scratch code is deleted. You chose Tauri (D1 option C).
**Result in short.** Nine and sixteen WebGL panes without context loss; key echo and throughput within the bars; the app about 29 times smaller and 21 to 41 percent lighter in memory; the Rust side reached the socket, started the holder detached and showed notifications from the bundled app; nothing to install beyond Rust, which the personal Mac already had. Not settled: two multi-second render stalls in 2 of 8 Tauri runs (plus one 108 ms frame and one run averaging 37.8 frames per second), and the work Mac was not tested.
**Where the open points are checked.** The work-Mac Rust install and the render-stall check are the gate in slice 1. If either fails, D1 reverts to A, and the window parts of slices 1, 4, 6, 7 and 8 and the bridge in D5 and D8 go back to their Electron form, done before slice 2.

### Slice 1. A shell tab that survives the window

**Outcome.** From `next/`, `npm run dev` (which runs `tauri dev`) opens a calm window with a sidebar (one fixed space, an empty agents list) and a tab running your shell or `claude` in a real terminal. A developer-only stress page shows nine terminals fed with synthetic output and logs frame times, lost contexts and key-echo times. Closing the window leaves the tab running; reopening shows the same screen. Restarting only the core also leaves it running, and starting a client when nothing is running starts the holder and core.
**Thin end-to-end:** window (xterm.js in the Tauri web view) -> Rust bridge (Tauri channel) -> core daemon (JSON-RPC over a unix socket) -> holder (PTY) -> shell or `claude`. Deliberately missing: saved spaces and tabs, status, OpenCode and Copilot, grid, command line, config files, worktrees, notifications.
**Files.** `next/package.json`, `next/README.md` (prerequisites: Node, git, Rust and the Xcode command line tools that the node-pty and Tauri builds need; notes that npm 11 skips node-pty's install script and that `~/.npm` can hold root-owned files; how to build the app bundle with `npm run build:app` for notifications), `next/packages/protocol/`, `next/packages/holder/`, `next/packages/core/`, `next/packages/ui/` (the web page, the stress page and `src-tauri/` with the Rust bridge: socket client, detached holder start, notifications). The core socket sits at a short path such as `~/.grove-next/s`, because macOS limits socket paths to about 104 bytes (general macOS knowledge, not from the research). The holder applies the node-pty spawn-helper fix that the old Grove applies in its postinstall step.
**Verification.** `cd next && npm test` passes, including tests that a new attach receives the saved screen, that the framing round-trips, and that the holder restarts a crashed core. By hand: `npm run dev`, open a tab in the fixed space, run `claude`, close the window, reopen it and see the same Claude screen repainted correctly; kill only the core process and confirm the tab is alive and repaints; `kill -9` the window and confirm the same. Then the work-Mac gate for D1. On the personal Mac, which already has Rust, only the stress page runs; the rustup install is untested on any Mac and is tried on the work Mac from a fresh clone (install Rust, `npm install`, `npm run dev`, see a tab survive the window). On both Macs run the stress page five times for 60 seconds, three times with the window brought to the front and twice left in the background behind another app. Pass: no frame over one second in any run, no lost context, an average of 30 frames per second or better, and key echo with a median of 50 ms or less and a 95th percentile of 100 ms or less; memory is recorded only. Fail, or Rust or the native builds cannot be installed on the work Mac: D1 reverts to A, the window parts done in Electron form come before slice 2, and `grove-run --continue` resumes from there. Because the review gate stops the run after slice 1, you run this gate during that review.

### Slice 2. Spaces and tabs that stick

**Outcome.** Spaces are saved and come back. You add one from the window or by running `grove-next space add` in a folder; the command (`next/bin/grove-next`, run with the system Node) starts the daemon if needed, so nothing extra is installed. Tabs are numbered, opened with "+", and each starts in its space's root folder. You create worktrees with git and add the folder as a space; a worktree space appears under its repo's space when the repo is also a space, and at the top level with the repo's name shown when it is not. After the app, core and holder are all killed (as a reboot would), reopening shows spaces and tabs with fresh shells. The old Grove is untouched.
**Files.** `next/packages/core/store/` (versioned JSON, atomic writes, bad file set aside), `next/packages/core/git.ts`, `next/packages/cli/` (`space add`, `ls`), `next/packages/ui/` sidebar and tab strip.
**Verification.** Tests: a corrupt state file is set aside and the app starts empty; an unknown schema version is refused; a temporary git repo with `git worktree add` groups the worktree under its repo and shows it top-level when the repo is not a space. By hand: add one space from the window and one from a terminal, open three tabs in each and run `pwd` in each (it equals the space root), quit, `kill -9` the core and holder, reopen and see the same spaces and tabs with fresh shells. Run the old Grove and the new app together: `grove ls` and `grove-next ls` show different sessions, the old Grove's state file has an unchanged checksum, and the old repository's `npm test` is unaffected.

### Slice 3. Claude status you can trust

**Outcome.** The agents list in the sidebar groups Claude tabs by state (needs you, working, finished, idle, unknown), each with the time since the last change, and the state follows what Claude does. Clicking an agent in the list focuses its tab. The finished state stays until slice 4 adds the seen mark. A gone Claude tab shows a one-click Resume. After the core or the window is killed and restarted, each tab's state is rebuilt from Claude's saved event file, not reset.
**Files.** `next/packages/core/status/` (the contract, cross-check and watchdog), `next/packages/core/agents/claude/` (per-launch settings with hooks, spool tailer with saved offsets, resume id), recorded Claude event and terminal-screen captures under `next/packages/core/agents/claude/fixtures/`, `next/packages/ui/` agents list.
**Verification.** Contract tests replay the Claude captures, including an interrupted turn, an Esc-rejected question that ends quiet (paired with the terminal screens before and after the Esc) and a turn woken by a background task, and assert the state sequence and that the stuck cases fall to `unknown` through the screen check or the silence threshold, with an injected clock. By hand: ask Claude to run a command that needs permission and see "needs you" within about two seconds; answer, and see working then finished; while Claude is waiting for permission `kill -9` the window and then only the core, reopen, and see "needs you" still shown for that tab; stop the spool reader and see "unknown" after the watchdog time; kill the holder and press Resume to bring the conversation back.

### Slice 4. Interrupts and the seen mark

**Outcome.** When a tab needs you or finishes and you are in another window or another tab, you get a macOS notification and a sound. Looking at the tab marks it seen. Clicking the notification brings you to the tab where macOS allows it (not tested in the spike). The rules are agent-neutral, so they apply to OpenCode and Copilot as soon as their adapters land.
**Files.** `next/packages/core/attention/` (transition rules, seen mark), `next/packages/ui/src-tauri/` (notifications and sound through the Tauri notification plugin).
**Verification.** Unit tests for each transition (working to needs-you, working to finished while unseen, finished cleared by seen, no noise for the focused tab). By hand, from the built app bundle (`tauri build`), because the spike showed banners from the bundle and none from a bare development binary: two Claude tabs, switch to another app, one asks for permission and the other finishes, and both notify with a sound; focusing a tab clears its finished state; record whether clicking the notification reaches the tab (not tested in the spike).

### Slice 5. OpenCode and Copilot

**Outcome.** OpenCode and Copilot start from the app with their own launch settings and report through the same status contract, including the interrupts of slice 4. A gone tab of either shows a one-click Resume. Where an agent has no reliable signal the tab shows "unknown". It lists only its own OpenCode sessions, although OpenCode's service is shared with the old Grove.
**Files.** `next/packages/core/agents/opencode/`, `next/packages/core/agents/copilot/`, their captures under `fixtures/`, a launcher table, and the Resume action for both.
**Verification.** Contract tests replay captured events per agent, including the cases documented as unknown, and an event-connection loss that falls to `unknown`. By hand on both Macs: run a tab of each agent, see correct states, and see a notification and sound when each needs you and when each finishes; kill the core and holder, reopen, press Resume and see the conversation return for each (pass means Resume works for OpenCode, and for Copilot either works or the tab shows Resume as unavailable with the reason; Copilot's resume flags come from community sources). Run the Copilot tab on the work Mac. Kill only the core while a tab of each agent is mid-turn, reopen, and see each state rebuilt (OpenCode through its re-sync snapshot, Copilot through its saved event-log offsets). With the old Grove running beside, each app lists only its own OpenCode sessions.

### Slice 6. The grid

**Outcome.** Grid mode shows up to nine live tabs in an automatic layout; clicking a pane focuses it, only the focused pane counts as seen, and unfocused panes are dimmed. Manual spans, draggable dividers and header-drag swap from today's grid are not part of v1.
**Files.** `next/packages/ui/grid/`, the multi-viewer size rule in `next/packages/core/` (the most recently active viewer owns the size).
**Verification.** Tests for the layout rules ported from the current grid tests. By hand: open nine tabs, run output-heavy commands in all of them, confirm every pane keeps updating with no lost-context warning in the console, and record the window's memory use in the run log (informational; v1 sets no limit).

### Slice 7. The command line

**Outcome.** From any terminal, `grove-next` can list, start, send to, read, wait for, focus and kill tabs, with the same exit codes as today (0 idle, 5 gone, 124 timeout). It is a script that runs under the system Node (from slice 2 it is started as `next/bin/grove-next`); a menu action in the window links it into `~/.local/bin`, as today, so nothing extra is installed. An agent in one tab can start another and wait for it. Today's `status` and `progress` labels are not carried over.
**Files.** `next/packages/cli/` (commands over the D5 protocol), `next/packages/core/` ref resolution (id, id prefix, exact label), the PATH install action.
**Verification.** Tests ported from the current command-line argument and operations tests. By hand: from a Claude tab in the new app run `grove-next new claude --prompt "say hi"` then `grove-next wait <ref>`; the new tab appears in the sidebar and the wait returns 0; the same command from the old Grove's tab cannot see the new app's sessions.

### Slice 8. Change the app with a sentence

**Outcome.** A config folder holds settings, keys, launchers, theme tokens and layout, each with a schema, and the app regenerates an `AGENTS.md` there on every start. Tabs get the folder's path in an environment variable, `grove-next config path` prints it, and `grove-next skill` installs the instruction snippet. Changes apply live; a broken file keeps the last good version and shows a note naming the problem. The README lists exactly what must be installed on a fresh Mac.
**Files.** `next/packages/core/config/` (schemas, watcher, last-good), `next/packages/ui/` (theme tokens as CSS variables, key bindings, layout), `next/packages/cli/` (`config path`, `skill`), `next/README.md`.
**Verification.** Tests for schema validation and last-good retention. By hand, after `grove-next skill`, using Claude, one sentence per kind in a new tab: a setting (sidebar width), a shortcut (rebind the grid toggle), the theme (a green accent), a launcher (add "claude plan" with an argument) and the layout (agents list above spaces); each applies live without a restart. Break a file on purpose and see the last good version stay with a clear note. On the work Mac follow the README from a fresh clone and record the install steps that were needed.

## Reviewer round log

- Round 1 (4 blocking, 15 non-blocking). Blocking: nothing decided who starts and supervises the core and holder → fixed by new D8 and the start-on-demand checks in slices 1, 2 and 7; no check that agents and status survive a hard kill → fixed by the catch-up from saved spool offsets and the `kill -9` checks in slice 3; the watchdog could not tell a quiet turn from a dead source → fixed in D3 by the terminal-activity cross-check and thresholds, and the Deviations line reworded; no way for an agent to find the config folder → fixed in D6 and slice 8 by the environment variable, `config path` and `skill`. Non-blocking: all 15 applied (unsupported claims softened in D1, D2 and D3; D2 option D given a pro; wording and scope fixes in slices 1, 2, 5, 6, 7 and 8; the grid, worktree and coexistence details added; D5 permissions, Copilot flags, WebGL and holder-supervision risks added; Claude Resume moved into slice 3).
- Round 2 (1 blocking, 10 non-blocking). Blocking: the terminal cross-check could not demote a `needs-you` left stale after an Esc that ends quiet → fixed in D3 by comparing the screen a few seconds after the event, plus a slice 3 replay case. Non-blocking: all 10 applied (state names aligned to "finished"; v1 runs from source under the system Node, stated in D8 and slice 7; the shared OpenCode service filtered by own sessions in slice 5; the skill and notification limits added to Deviations; the status label dropped from slice 7; click-to-focus and the socket path length added; unsupported wording in D1 and D2 corrected; the long quiet tool run named as a risk).
- Veto: D1. You asked for a Tauri spike before committing; the pick stays A until the spike reports, and Spike S0 was added before slice 1 (not counted as a slice). Reviewer on the change (3 blocking, 9 non-blocking): option C rewritten as the Tauri window with the Node core, which is what the spike tests, and a Rust-core Tauri option and GPUI kept as separate options; a rule that approval and `grove-run` wait for the spike and a final D1 pick; D8's start rule and the Rust-side holder start added to what the spike checks and what changes if Tauri wins; numeric bars, a worth-switching rule, the Mac used, isolation from the old Grove, Tauri notifications and the Pick line cleaned up.
- Revision after Spike S0: you chose Tauri, so D1 is now C, final subject to the work-Mac gate in slice 1; the spike findings replace the earlier estimates in D1; D5's bridge and D8's holder start now use Tauri's Rust side; slices 1 and 4, Deviations and Risks were changed to match; `based_on` refreshed to `02-research.md@2`. Reviewer on the revision (4 blocking, 13 non-blocking): a reversed memory comparison corrected; one revert-to-A rule stated in D1, S0, slice 1 and Deviations; the slice 1 gate made strict (no frame over one second in any of five runs, three with the window in front and two behind, plus the frame-rate and echo bars); the gate and the Rust and Xcode installs added to the work-Mac Deviations; all non-blocking items applied (release-build timing wording, what the 90 lines cover, units, what the memory figure includes, the 37.8 fps run named, rustup untested, README notes, click-through softened, the locally built bundle for notifications stated).
- CTO check (0 blocking). Seven departures were in the body but not in Deviations (stale state after a core restart, false unknown, holder death, Copilot Resume, unsigned notifications, nothing running after reboot, unverified snippets) → fixed by adding them to Deviations.
- Round 3 (0 blocking, 11 non-blocking). Applied: a work-Mac run of slice 1 and the node-pty toolchain and spawn-helper note; the selection-move and core-restart weaknesses of the screen check named in D3; the finished state noted as staying until slice 4; the skill scoped to `GROVE_NEXT_CONFIG` and marked verified for Claude only; the cutover and data-folder collision, the unverified root workspace settings, pros for every option, general-knowledge labels, the holder-upgrade cost, the slice 1 cut rule, pass conditions for Resume and memory, the unsigned notification caveat and the Node path in D8. The worktree-by-hand departure (item 11) is kept in Deviations for the human to accept.

## Deviations from the brief the human should know

- D1 is Tauri (option C), chosen after the spike. It adds a Rust toolchain on top of Node on both Macs (the rustup install is untested on any Mac, and the Xcode command line tools are a new install on a Mac that lacks them), and `npm run dev` runs `tauri dev`. The spike saw two multi-second render stalls in 2 of 8 runs, cause unknown. If the work-Mac gate in slice 1 fails, D1 reverts to Electron.
- The brief says "the `grove` command". During coexistence the new command is `grove-next` (D7), so skills and agents that call `grove` keep driving the old app until the cutover.
- Grid mode in v1 is the automatic layout with focus and dimming. Manual spans, draggable dividers and header-drag swap from today's grid are left out.
- The new app does not create worktrees in v1; you make them with git and add the folder as a space. The old Grove could create them from its launch dialog.
- "Never wrong for more than a few seconds" is a target. In the known gap cases (an interrupt or an Esc-rejected question that fires no Claude hook) D3's rules bound the error to about 30 seconds before the state falls to "unknown". Whether the fast cases always meet a few seconds is shown by the replay tests, not guaranteed.
- One-click Resume arrives for Claude in slice 3 and for OpenCode and Copilot in slice 5. Until then a gone tab shows as gone.
- The research found no documented question signal for Copilot, so that case may show "unknown" rather than a state.
- The work-Mac checks (the Rust install and stress-page gate in slice 1, Copilot in slice 5, install steps in slice 8) are manual and happen on that machine; an unattended run cannot do them. Slices 2 to 8 are not built until the slice 1 gate has run; the run stops after slice 1 for that reason.
- Notifications in daily use need the app bundle built locally from source with `npm run build:app` on each Mac; it is not a distributed package, so there is still no packaged app.
- Version 1 runs from source on both Macs (system Node, `npm run dev`), as you do today; there is no packaged app.
- "Ask an agent in one sentence" needs a one-time `grove-next skill` so that agents know where the config folder is.
- Notifications are raised by the window's process, so nothing notifies while the app is fully quit, even though agents keep running. In the spike banners appeared only from the built app bundle, not from a bare development binary, so a `npm run dev` window may show none.
- After a reboot nothing runs until you open the app or run the command (D8).
- Status can still be wrong in some cases: after the core restarts, an Esc-rejected question or interrupted turn can show a stale state until the next real event, which can be longer than 30 seconds; a long quiet tool run or a moved selection in a permission dialog can show a false "unknown" (D3).
- If the holder dies, its agents die, and nothing supervises the holder (D2).
- Only Claude's instruction snippet is verified in v1; the OpenCode and Copilot snippets are best effort (D6). Copilot Resume may be shown as unavailable, since its resume flags come from community sources.
- A worktree is a space under its repo (D4); there is no parent and child between tabs. An agent that starts another tab through the command line gives a sibling tab.

## Risks and what is deliberately not done

- Reattach fidelity for full-screen agent interfaces is unproven until slice 1; if the headless screen is not good enough, D2 must be revisited before anything else is built.
- Nine live WebGL terminals in the system web view: the spike found no context loss at nine or sixteen, but saw two unexplained render stalls of seconds in 2 of 8 Tauri runs. The macOS web view updates with the OS and the spike ran on one macOS version only. Slice 1's stress page and slice 6 re-measure; the fallback is disposing hidden panes.
- OpenCode's event API is marked experimental upstream, and Copilot's signals and resume flags are partly unverified (the flags come from community sources); those adapters are the most likely to show "unknown" or to fail on Resume.
- If the holder dies its agents die, and nothing supervises the holder. It is kept tiny and rarely changed for that reason.
- An agent may not follow the instruction snippet from `grove-next skill`; slice 8 verifies it only with the snippet this plan installs.
- A long, quiet tool run can show a false `unknown` until its next event; the silence threshold is a setting.
- Slice 1 carries a lot for a thin slice (protocol, holder, supervision, screen model, bridge, window). If it grows, cut the window polish and the core supervision first, never the reattach proof.
- Notifications from a bare development binary may not appear on macOS; slice 4 verifies from the built app bundle and records what appears, including whether clicking reaches the tab.
- The cutover that swaps `grove-next` and `~/.grove-next` for the old names would collide with the old Grove's `~/.grove` data. It needs its own plan and must not merge the two data folders.
- Any process running as you can drive the core through its socket; the socket folder is private (mode 0700), and there is no further access control, as today.
- Tauri adds a Rust toolchain and about 90 lines of Rust (bridge, holder start and notifications in the spike) to maintain (D1), and the Rust and Node halves must be kept in step. A later Rust core is possible because of D5, but it is not planned here.
- Not done, on purpose and per the brief: workflow features and artifacts, review comments, diff and the Changes view, dictation, scratchpad, the classifier, grove-run as an app feature, code add-ons, remote machines, Windows and Linux, and migrating anything from the old Grove.

## Open questions
