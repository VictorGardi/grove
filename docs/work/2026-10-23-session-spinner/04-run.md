---
feature: 2026-10-23-session-spinner
phase: run
status: draft
version: 1
created: 2026-10-23
updated: 2026-10-23
approved_at:
based_on: [03-plan.md@1]
forced: []
---

# Run: session spinner while a session starts

Profile: inherit
Branch: feature/2026-10-23-session-spinner-inherit
Plan commit: 0c9aa39529a3555543e647852aa550c800477bcf
Roles:
- cto: claude, inherit
- researcher: claude, inherit
- planner: claude, inherit
- reviewer: claude, inherit
- implementer: claude, inherit

## Slice 1

Session: session-spinner-slice-1-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `sessionCreate` (core.ts ~823) runs preflight, resolves the project, builds argv, calls `backend.create`, and only then adds the session to `slices.sessions`. `set('sessions')` persists everything except a list of live-only fields. `reconcile` (core.ts 426, 1136) marks any running session absent from tmux `gone`. `shownStatus` (sessionStatus.ts) maps `lastStatus`/`status` to the dot; `URGENCY` indexOf would give an unknown status rank -1 (most urgent). `Spinner` is a fixed 12px ring; `StatusDot` takes a tone.

Implementer 1 (core, shared types, state store):
- [x] `src/shared/types.ts`: `Session.startup?: { phase: 'starting'; since: string }` (never saved)
- [x] `src/core/sessions.ts`: pure `clearStarted(sessions)` dropping `startup` once `status` is set or `lastStatus` is `gone`
- [x] `src/core/core.ts`: placeholder in `sessionCreate` before `backend.create` (in-memory `pending` set of ids, kept out of the saved file and added to the `live` set passed to `reconcile`), removed again if create throws, replaced by the real session after; `clearStarted` in `withAllStatus`; kill/remove of a pending session refused
- [x] `src/core/store/stateStore.ts`: `saveState` strips `startup`
- [x] tests: core (startup set then cleared on first status; not on disk while pending; not marked gone by reconcile; failing `backend.create` removes the placeholder), state store, sessions.test factory unaffected

Implementer 2 (renderer):
- [x] `sessionStatus.ts`: `'starting'` shown status and tone, URGENCY after idle before running
- [x] `Spinner.tsx` + css: size variant; `ListRow.tsx`, `SidebarRail.tsx` + css: spinner in the dot position
- [x] `sessionStatus.test.ts` cases

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer, no blocking findings.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: (1) a `backend.list()` that resolves just after the pane appears can briefly mark the new session gone (narrow race, existed before); (2) `attach`, `sendToSession` and CLI send/capture accept a placeholder id during the create window; (3) a failed create leaves a newly resolved project registered (known, plan notes it); (4) other consumers (`deriveFeatures`, CLI list, `hasLiveSessions`) see the placeholder as running; (5) the terminal clear path via the foreground poll has no test; (6) the placeholder test relies on `setTimeout(0)`; (7) no test loads a state file containing `startup`; (8) `clearStarted` also runs on pending sessions; (9) `startup` is stripped in two places.

### Deviations

- `URGENCY` already ranks `starting` (waiting, working, idle, starting, running, gone), moved up from slice 6, because an unranked status would sort as most urgent. Slice 6 keeps its tests and the collapsed-parent wiring.
- The `StatusDot` renders the small spinner for `starting`, so the compact card, board and collapsed-parent dots need no per-site change. The non-compact `ListRow` card and the rail tile draw a CSS-only ring on their own dot (`.s-starting`, `.t-starting`), so they do not use the `Spinner` component.
- A new project resolved from `cwd` is now registered before `backend.create`, so a failed create leaves it registered.
- With the agent service already connected, OpenCode sessions can lose `startup` at once because their status appears immediately; Claude and terminals keep it until their first status.
- `sessionKill` and `sessionRemove` refuse a placeholder with error `starting`.

### Verification

`npm test` (1198 passed) and `npm run typecheck` pass; one earlier full run had a single failure that did not reproduce in three further runs. New tests: `src/core/sessionStartup.test.ts`, `clearStarted` in `sessions.test.ts`, `saveState` in `stateStore.test.ts`, `starting` cases in `sessionStatus.test.ts` and `tree.test.ts`. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Visual size and position of the spinner on cards and rail tile, and `npm run dev` with a Claude session, a terminal and an OpenCode session (spinner, then dot).

## Slice 2

Session: session-spinner-slice-2-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `termPoll` (core.ts, armed unconditionally in `start()`) calls `refreshTerminals`, which returns early when no running terminal exists. `startup.since` is set when the placeholder goes in (slice 1). `now` is injectable through `CoreOptions`. `pending` holds ids still inside `backend.create`.

Implementer 1:
- [x] `src/core/sessions.ts`: pure `expireStarted(sessions, nowMs, skip)` dropping `startup` at 60 s, same array when unchanged
- [x] `src/core/core.ts`: `sweepStartup()` called first in `refreshTerminals`, before its early return, skipping `pending`
- [x] tests: `expireStarted` unit tests in `sessions.test.ts`; fake-timer core tests in `sessionStartup.test.ts` (59 s / 60 s, no failed state, no terminals present, untouched array without startup, status after timeout)

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer, no blocking findings.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: (1) if `backend.create` takes over 60 s, `startup` expires on the first tick after creation because `since` is set at placeholder time (slice 5 may reset it when the pane appears); (2) an unparseable `since` counts as expired (benign); (3) the test helper's `kind` argument is only used for opencode, no terminal-specific expiry test; (4) expiry lands up to 1 s after 60 s; (5) `STARTUP_TIMEOUT_MS` is exported but only used in `sessions.ts`.

### Deviations

none

### Verification

`npm test` (1203 passed) and `npm run typecheck` pass. Models requested: implementer inherit, reviewer inherit.

### Left for the human

none

## Slice 3

Session: session-spinner-slice-3-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `sessionCreate` ran preflight first and the placeholder only after sandbox argv; slice 1 removed the placeholder on a throwing create. `pending` ids are never saved or marked gone; `clearStarted`/`expireStarted` act on `startup` regardless of phase; `dropSessions` restores focus and grid.

Implementer 1 (core, shared):
- [x] `types.ts`: `startup` also `{ phase: 'failed'; reason }`
- [x] `core.ts`: placeholder before preflight and sandbox argv; any later failure (refusal or throw) marks it `failed` via a `failedNew` set (unsaved, not marked gone, kill refused, remove dismisses); `sessionDismissStartup` (new session: `dropSessions`; resumed session: clears `startup` only); `session:create` returns/throws as before
- [x] `sessions.ts`: `clearStarted`/`expireStarted` only touch `phase: 'starting'`
- [x] `shared/ipc.ts`, `main/ipc.ts`: `session:dismissStartup`
- [x] tests: sessionStartup, sessions, sessionCreate, cliServer updated

Implementer 2 (renderer):
- [x] `sessionStatus.ts`: `failed` shown status (over gone), label `failed · <reason>`, first in URGENCY
- [x] `StatusDot`, `ListRow`, `SidebarRail` css: danger dot; card Dismiss button, card click inert when failed; rail tile click opens `ConfirmDialog`, tile title carries the reason
- [x] `sessionStatus.test.ts`

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer, 1 blocking: dismissing a new failed card used a bare filter, leaving focus and grid stale. Fixed with `dropSessions`, plus a focus-restore test. Verdict: approved after 1 fix round (re-review not run; the fix is the one-line change the reviewer named, verified by the new test). Non-blocking applied: failed card click is a no-op. Non-blocking left: (1) a refusing preflight with `cwd` now leaves a newly resolved project registered; (2) a failed card can still be chosen as a parent, renamed or linked; (3) the label shows the raw error code, not `errorMessage(code)`; (4) no test of `dismissStartup` on a resumed session (slice 4) or `no-feature`; (5) rail click and dismiss button are manual checks.

### Deviations

- Existing tests that expected no session after a failed start (copilot missing, sandbox refusal, throwing create) now expect the failed card.
- Preflight now runs after project resolution, so a missing agent with `cwd` leaves a newly resolved project registered.
- A failed resumed session shows `failed` over its `gone` state; slice 4 wires resume itself.
- Worktree failures (slice 5) are not covered yet.

### Verification

`npm test` (1214 passed) and `npm run typecheck` pass. Earlier runs showed one unrelated flaky test (`pruneContainers`), green on rerun. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Manual: `npm run dev`, force a failure (Copilot with no binary), see the error card and rail tile dot, hover for the reason, dismiss from the card button and from the rail dialog.

## Slice 4

Session: session-spinner-slice-4-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `sessionResume` (core.ts) built argv, killed the dead pane, created the pane and replaced the session with `resume(...)`; no `startup`. `clearStarted` clears `startup` on any `gone` session, which would end a resume's spinner at once. `pending` sessions are excluded from the saved file, which a resume must not be (its saved copy stays `gone`).

Implementer 1:
- [x] `src/core/sessions.ts`: `resume()` drops the stale `status`; `clearStarted` takes a `skip` set
- [x] `src/core/core.ts`: a `resuming` set (not `pending`, so the saved copy stays); `sessionResume` sets `startup: starting` with a fresh `since` before the pane is made, skips sweeps while resuming, refuses kill/remove/second resume (`starting`), and on any throw leaves a `failed` card on the still-`gone` session and rethrows
- [x] `src/core/sessionResumeStartup.test.ts`: own `since`, saved without `startup`, stale status cleared, 60 s expiry, sweeps leave a resuming session alone, failed create keeps the saved copy `gone` and dismiss clears only `startup`

Models passed: implementer: inherit (done by the planner in this session), reviewer: inherit

### Review rounds

Round 1: fresh reviewer, no blocking findings.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: (1) a session dropped mid-resume (project removal) leaves an orphan pane; (2) in-memory `status` is not restored after a failed resume (harmless); (3) the restart test only checks the saved file, not a real restart; (4) no sandbox-downgrade test and no second-resume-after-failure test; (5) the error-text expression is duplicated from the create path.

### Deviations

- A `resuming` set was added beside `pending`, because `pending` sessions are never saved and a resumed session must stay saved as `gone`.
- `sandboxArgvFor` now runs inside the try, so a throwing sandbox build also leaves a failed card.
- A second `sessionResume` while one runs returns `starting`.

### Verification

`npm test` (1220 passed) and `npm run typecheck` pass. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Manual: resume a gone session in `npm run dev` and see the spinner, then the dot.

## Slice 5

Session: session-spinner-slice-5-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: the app made the worktree with `worktree:create` and only then called `session:create`, so core saw no session during `git worktree add`. `worktreeCreate` held the add and registration inline. `sessionCreate` already puts a `starting` placeholder in before preflight (slice 3) and marks it `failed` on any later error.

Implementer 1 (done by the planner in this session):
- [x] `src/core/core.ts`: `makeWorktree` extracted from `worktreeCreate`, with injectable `worktreeAdd` option; `sessionCreate` takes `worktree`, runs it after preflight, re-homes the placeholder (same id, fresh `since`) to the worktree project, and fails the card on a worktree error
- [x] `src/shared/ipc.ts`: `session:create` input `worktree`
- [x] `src/renderer/src/App.tsx`: `startLaunch` passes `worktree` instead of calling `worktree:create`; the dialog already stays busy for the whole call, so it needed no change
- [x] `src/core/sessionWorktreeStartup.test.ts`: card under the source while the add is held then same id under the worktree project; git failure leaves a failed card and no project; pane failure keeps worktree and project and fails only the card; feature refused

Models passed: implementer: inherit (done by the planner in this session), reviewer: inherit

### Review rounds

Round 1: fresh reviewer, no blocking findings. Non-blocking: added the D2 test (pane failure after the worktree is made). Left: (1) a rejected branch or base leaves a failed card beside the dialog error, one per retry; `no-branch` and `no-repo` now also leave one; (2) `worktree` with `cwd` answers `not-found`; (3) the worktree project exists one tick before the card moves; (4) a source project removed mid-add orphans the card until the re-home; (5) no test for sandbox with a worktree, preflight order, `lockWorktree`, or the renderer `startLaunch`; (6) the early-state test waits 20 ms rather than on the mock; (7) `session.projectId` in the local object stays the source id.

### Deviations

- `feature` with `worktree` is refused with `no-feature` (a new worktree has no features until discovery runs).
- `startup.since` is reset when the card moves, so the 60 s clock starts after the worktree exists.
- `NewSessionDialog` unchanged.
- `worktree:create` remains as a command but the app no longer calls it.

### Verification

`npm test` (1223 passed, plus one test added after) and `npm run typecheck` pass. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Manual: `npm run dev`, start a session with a new branch; the card appears under the source project with a spinner, moves to the worktree project, and focus stays on it.

## Open questions
