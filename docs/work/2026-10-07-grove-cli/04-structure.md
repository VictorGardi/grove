---
feature: 2026-10-07-grove-cli
phase: structure
status: approved
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at: 2026-10-07
based_on:
  - 03-design.md@2
forced: []
---

# Grove CLI — structure

Build after `2026-10-07-review-comments` slice 1, which provides `paste`,
`capture` and `sendToSession`. Slices 1, 2 and 4 don't need it.

## Slices

### Slice 1 — `grove ls` from a grove session (tracer)

- **Outcome:** in a new grove terminal session, `grove ls` prints the
  sessions table, marking the caller with `*`, and `grove ls --json` prints
  JSON. With the app quit, `grove ls` exits 3 with the not-running message.
  Launching the app a second time focuses the first window.
- **Files:**
  - `shared/cli.ts`
  - `cli/{index,args,output,client}.ts`
  - `main/cliServer.ts` (`sessions.list` only) and `main/launcher.ts` (`writeLauncher`)
  - `main/index.ts`: lock, server, launcher
  - `electron.vite.config.ts` (cli input)
  - `backend.create({env})`, `loginShellArgv` PATH prefix, `GROVE_*` env in `sessionCreate`/`sessionResume`
- **Signatures:** `parseCommand`, `request`, `startCliServer`, `writeLauncher`.
- **Verify:**
  - `npm test`: `args.test.ts`; `output.test.ts`; `client.test.ts`
    ("ENOENT → exit 3"); `env.test.ts` "PATH prefix runs after rc"; a core
    test that `create` passes the `GROVE_SESSION_ID` env.
  - `npm run typecheck`; `npm run build` produces `out/main/cli.js`.
  - Manual: in `npm run dev`, open a terminal session and run `grove ls`.
- **Depends on:** none.

### Slice 2 — `grove new` in any folder, with prompt, label and link

- **Outcome:** `grove new claude --cwd ~/git/other --prompt "say hi" --label
  helper` starts a background Claude session in that folder. The session
  shows in the sidebar under the folder's project, which is registered if new,
  and the prompt runs. `--link` pins a feature. Resume restarts the session in
  the same cwd.
- **Files:**
  - `core/cliOps.ts` (`resolveProject`, `resolveSessionRef`)
  - `core.ts` (`sessionCreate` options, `cwd` on resume)
  - `sessions.ts`
  - `stateStore.ts` (`v3ToV4`)
  - `agents/types.ts`, `opencode/client.ts`, `claude/{hooks,source}.ts` (argv opts)
  - `cliServer` (`sessions.create`)
- **Verify:**
  - `npm test`: `cliOps.test.ts` covers "longest containing project", "git
    top level registered", "prefix/label/ambiguous refs";
    `stateStore.test.ts` covers "v3 → v4 sets cwd null";
    `sessions.test.ts` covers "create argv carries prompt and name per kind"
    and "resume uses cwd".
  - Manual: run the command above, then `--link` with an unknown slug →
    exit 1, and nothing is created.
- **Depends on:** 1.

### Slice 3 — `grove send` and `grove read`

- **Outcome:** `grove send <ref> "text"` submits the text in that session,
  and `-` reads stdin. `--no-enter` pastes without submitting.
  `grove read <ref> --lines 40` prints the pane's last 40 lines.
- **Files:** `cliServer` (`sessions.send`, `sessions.read`); `core.ts`
  (`sessionRead`); the output.
- **Verify:**
  - `npm test`: a server dispatch test with `setupCore()` checks that
    `send` reaches `FakeBackend.paste` and `read` returns its capture.
  - Manual: from one grove session, `grove send <other> "reply pong"`, then
    `grove read <other>` shows the answer.
- **Depends on:** 1; review comments slice 1 (slice 6 for resume-on-gone).

### Slice 4 — `grove wait`, `send --wait`, `new --wait`

- **Outcome:** `grove wait` blocks until the session stops working. It exits
  0 when finished, 4 when waiting on permission or a question, 5 when gone and
  124 on timeout. `--wait` on `send` and `new` waits for the turn they start.
- **Files:** `cliOps.ts` (`waitTurn`); `cliServer` (`sessions.wait`, and
  `--wait` on send/create); the client keeps the connection open.
- **Verify:**
  - `npm test`: `cliOps.test.ts` `waitTurn` with FakeAgentSource and fake
    timers covers "idle → immediate", "expectStart: working then idle → 0",
    "permission → 4", "gone → 5", "timeout → 124" and "terminal → no-status".
  - Manual: `grove new opencode --prompt "count to 5" --wait` returns when
    the turn ends.
- **Depends on:** 2 (`new --wait`), 3 (`send --wait`).

### Slice 5 — `focus`, `kill`, install and skill

- **Outcome:**
  - `grove focus <ref>` shows the session and raises the window.
  - `grove kill <ref>` ends it, and it shows as gone.
  - **grove → Install Command Line Tool…** links `~/.local/bin/grove` and
    reports whether that directory is on `PATH`.
  - `grove skill` prints the skill.
- **Files:** `cliServer` (`sessions.focus`, `sessions.kill`); `launcher.ts`
  (`installCommandLineTool`); `menu.ts`; `resources/skills/grove/SKILL.md`.
- **Verify:**
  - `npm test`: dispatch tests check that `focus` calls `uiSet` and `raise`,
    and that `kill` marks the session gone.
  - Manual: install from the menu, open a new macOS Terminal, run
    `grove focus <ref>` (the window comes to the front), then
    `grove skill | head`.
- **Depends on:** 1.

## Deferred

- Parent/child session records; `remove`; launching the app from the CLI.
- An events stream (`grove watch`); per-session worktrees.
- A launcher that works in packaged builds (epic child 8).

## Rollout / migration

- The state file goes from v3 to v4 (`cwd: null`). A v4 file is unreadable by
  older builds; it is moved aside as `.bad-<ms>`, as with every bump.
- Sessions already running when this ships have no `GROVE_*` environment
  until they are resumed.

## Open questions
