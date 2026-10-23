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

## Open questions
