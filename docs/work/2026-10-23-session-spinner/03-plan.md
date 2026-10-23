---
feature: 2026-10-23-session-spinner
phase: plan
status: approved
version: 1
created: 2026-10-23
updated: 2026-10-23
approved_at: 2026-10-23
based_on: [01-outcome.md@1, 02-research.md@1]
forced: []
---

# Plan: session spinner while a session starts

## Decisions

### D1. Where the "starting" state lives

**Context.** Today a fresh session has no status and the card only exists after tmux has made the pane. The sidebar and rail only learn about sessions through the pushed `state:sessions` array, so the new state has to reach them some way.

**Options.**
- A. A never-saved field on `Session` (`startup?: { phase: 'starting' } | { phase: 'failed', reason: string }`), set by core, pushed through the existing `state:sessions` slice. Pros: one source of truth for sidebar, rail, CLI and resume; same pattern as `status`. Cons: touches the shared type and test factories; must be kept out of the saved state file; the placeholder is a `Session` with no pane yet, so every consumer of `slices.sessions` (gone detection, terminal activity poll, status refresh, kill/remove, worktree locking) must leave a `startup` session alone until its pane exists. `startup` carries its own start timestamp (`since`), so a resumed session's 60 s clock is not the old `startedAt`.
- B. A renderer-only set of pending ids. Pros: no core change. Cons: the renderer does not know the session id until `session:create` returns, so there is no card during startup; resumed and CLI-started sessions are invisible to it. Rejected for that reason.

**Pick:** A

**Outcome impact.** The card exists and spins for every way a session can be started (app, CLI, resume), not only the dialog.

### D2. Who owns the worktree step of a new session

**Context.** The brief wants the card to appear at once, even while a worktree is being made. In the app the renderer calls `worktree:create` and only then `session:create`, so core sees no session until the worktree exists.

**Options.**
- A. `session:create` takes an optional `worktree: { branch, base }` and core makes the worktree itself. The placeholder card goes in at once under the source project, and moves to the new worktree project when it exists. Pros: matches the brief exactly; one place owns startup and its failures. Cons: the card moves in the sidebar once; the renderer's `startLaunch` and `worktree:create` use change.
- B. Keep the two calls; the card appears when `session:create` starts, and the dialog keeps showing the worktree step. Pros: no restructuring. Cons: departs from the brief ("even during worktree creation").

**Pick:** A

The placeholder is mutated in place: its `id` never changes, so focus and selection survive the move. If tmux fails after the worktree was made, the worktree and its project stay (as today when a session fails after `worktree:create`) and only the card is marked `failed`.

**Outcome impact.** Instant feedback for worktree sessions, at the cost of a card that shifts from the source project to its worktree once the worktree exists.

### D3. What ends the spinner, and who owns the timeout

**Context.** "Up and running" means the first live status (`status` set). A silent agent must stop spinning after about 60 s without an error.

**Options.**
- A. Core clears `startup` when `status` first appears, and on a sweep of the existing 1 s tick once 60 s have passed since start. Pros: deterministic, unit-testable with a fake clock, the same for every client. Cons: a little more core state.
- B. Renderer derives it from `startedAt` age and a timer. Pros: no core sweep. Cons: every client (app, CLI listing) would have to reimplement the 60 s rule, and the renderer needs a timer to re-render when it passes.

The sweep rides `termPoll`, the 1 s interval `start()` arms unconditionally (`core.ts:1151`), so it runs even with no terminal sessions.

**Pick:** A

**Outcome impact.** Nothing spins forever; the 60 s limit behaves the same wherever the session was started.

### D4. How a failed start is kept and dismissed

**Context.** Real failures (preflight, sandbox, worktree, tmux) must leave an error card the human can dismiss, and still tell the dialog or CLI what went wrong.

**Options.**
- A. The session stays in the sessions slice marked `failed` with the reason. A new session's placeholder is never saved to disk; a resumed session is saved as `gone` (its real saved state), with `startup` live only. A new `session:dismissStartup` command ends a failed card: it removes a never-started placeholder, and for a failed resume only clears `startup`, leaving the session `gone` and resumable (a transient tmux error never deletes saved history). `session:create` still returns the error. Pros: reuses the remove path; dialog and CLI keep their current messages. Cons: a CLI start that fails also leaves a card in the app until dismissed.
- B. Failures drop the card and only show a toast. Pros: clean. Cons: contradicts the brief.

**Pick:** A

**Outcome impact.** Failure is visible on the card with the reason on hover; refusals of bad input made before any project is resolved (unknown project, no source, bad parent or feature) still show only in the dialog, as today.

### D5. How a collapsed parent ranks a starting or failed child

**Context.** A collapsed parent shows its most urgent child. The brief: spinner only if no child has a more urgent status; existing ranking must not change.

**Options.**
- A. Insert `failed` first (an error is never hidden) and `starting` after `idle` and before `running`: waiting, working, idle, starting, running, gone with failed on top. Pros: errors surface; existing relative order unchanged. Cons: `failed` outranks `waiting`.
- B. `starting` last, `failed` just above it. Pros: the smallest change. Cons: a parent with a running sibling never shows the spinner; a failure can be hidden.

**Pick:** A

**Outcome impact.** A failed child shows on its collapsed parent; a starting child shows only when nothing more urgent exists.

## Slices

### Slice 1. A new session shows a spinner until its first status

**Outcome.** Starting a session from the app puts its card in the sidebar and rail with a spinner in the dot position; the first status replaces it with the usual dot. If the start fails after the card is in, the card is removed again (slice 3 turns that into an error card), so nothing spins forever. Slices 1-3 are one release unit: the brief needs the timeout and the error card, so the run is not merged before slice 3 is done.
**Thin end-to-end:** core `sessionCreate` (placeholder before tmux, `startup: starting`, cleared when `status` appears) -> `state:sessions` push -> sidebar `ListRow` and rail `Tile` spinner. Deliberately missing: timeout, failures, resume, worktree step, parent roll-up.
**Files.** `src/shared/types.ts` (`Session.startup`), `src/core/core.ts` (`sessionCreate`; status refresh; gone detection, terminal activity and kill/remove/worktree-lock paths skip a `startup` session whose pane does not exist yet), `src/core/store/stateStore.ts` (a new session's placeholder, whole, and `startup` on any session, are never written to the file), `src/renderer/src/sessionStatus.ts` (`'starting'` shown status and tone), `components/ui/Spinner.tsx` + `.module.css` (size variant), `components/ui/ListRow.tsx`, `components/SidebarRail.tsx` + `.module.css`, test factories that build a `Session`.
**Verification.** `npm test` and `npm run typecheck` pass with new tests: core test that a created session carries `startup: starting` and that it clears when the first status is applied; `sessionStatus.test.ts` cases for `starting`; a state-store test that a placeholder session is never written to disk (so no phantom `gone` card after restart), that `startup` is stripped from saved sessions, and that sessions load without it (restart-restored sessions never spin); a test that a `startup` session with no pane is not marked `gone` by the sweeps; a test that a failing `backend.create` removes the placeholder; a factory test with `startup` unset. Visual size and position of the spinner are manual checks only (vitest has no DOM). Manual: `npm run dev`, start a Claude session, a terminal and an OpenCode session (three different status timings), see the spinner on card and rail tile, then the dot.

### Slice 2. A silent agent stops spinning after 60 s

**Outcome.** A session whose agent never reports a status loses its spinner after about 60 s and looks like a normal card, with no error.
**Files.** `src/core/core.ts` (sweep inside the always-armed `termPoll` tick), `src/core/status.ts` or a new small pure helper, matching tests.
**Verification.** A test with an injected clock: `startup` still set at 59 s, cleared at 60 s, no `failed` state, no change for sessions without `startup`; a status arriving after the timeout still shows the dot; the sweep clears with no terminal sessions present. `npm test`.

### Slice 3. A failed start becomes a dismissable error card

**Outcome.** Preflight, sandbox, tmux and (later) worktree failures turn the card into an error card with the reason on hover; dismissing removes it. The dialog and CLI still get the error.
**Files.** `src/core/core.ts` (`sessionCreate`: place the placeholder after project resolution, run `preflight` after it, mark `failed` on any later failure), `src/renderer/src/sessionStatus.ts` (`'failed'`), `StatusDot` and `ListRow`/`SidebarRail` styles and title, dismiss: a dismiss button on the `ListRow` card; the rail has no context menu, so clicking a failed rail tile opens the existing `ConfirmDialog` to dismiss (CSS module styles, no inline styles per `noInlineStyles.test.ts`); the rail tile shows the same error dot with the reason as its `title`. Both call a new `session:dismissStartup` (`src/shared/ipc.ts`, `src/main/ipc.ts`, `src/core/core.ts`), tests. A failed new-session card is not saved, so it also disappears on app restart.
**Verification.** Core tests: refusal messages from preflight and the early refusals are unchanged by the reorder; a refusing preflight, a sandbox refusal and a throwing `backend.create` each leave a `failed` session with the reason, `session:create` still returns `ok: false`, `dismissStartup` removes a placeholder, and refusals before project resolution leave no card. Manual: `npm run dev`, force a failure (for example Copilot with no binary), see the error card and the rail tile's error dot, hover for the reason, dismiss it from both.

### Slice 4. A resumed session spins too

**Outcome.** Resuming a gone session shows the spinner until its first status.
**Files.** `src/core/core.ts` (`sessionResume`, including a throwing `backend.create`), tests.
**Verification.** A core test that `sessionResume` sets `startup: starting` (with its own `since`, not the old `startedAt`) and that it clears on the first status or after 60 s; a resumed session already has a dead pane and is not re-marked `gone` or overwritten by sweeps while `startup` is set; a prior run's `status` is cleared on resume so a stale dot never ends the spinner; a throwing `backend.create` on resume leaves a `failed` card, the saved copy stays `gone`, and `dismissStartup` clears only `startup`; restart-restored sessions load without `startup` (state-store test). Manual: resume a gone session in `npm run dev`.

### Slice 5. The card appears during worktree creation

**Outcome.** Starting a session in a new worktree puts its card in at once under the source project, with the spinner; it moves to the worktree project when that exists.
**Files.** `src/shared/ipc.ts` (`session:create` input `worktree`), `src/core/core.ts` (`sessionCreate` uses `worktreeCreate` internals, then re-homes the session), `src/renderer/src/App.tsx` (`startLaunch`), `NewSessionDialog` (the worktree step no longer a separate call; the dialog stays busy for the whole `session:create`, then closes), tests, plus an injectable worktree-add dep in core so a test can hold it open.
**Verification.** Core test: with the injected slow worktree add, the placeholder is in `sessions` before it resolves, then has the worktree project's id; a worktree failure leaves a `failed` card and returns the error; the card keeps the same `id` across the move to the worktree project, which is what `startLaunch`'s `setFocused(res.data.id)` relies on. `npm test`, `npm run typecheck`. Manual: start a session with a new branch in `npm run dev` and check that focus stays on the card after it moves.

### Slice 6. A collapsed parent shows a starting or failed child

**Outcome.** A collapsed parent shows the spinner when its most urgent child is starting, and the error when one failed.
**Files.** `src/renderer/src/sessionStatus.ts` (`URGENCY`), `components/Sidebar.tsx` (collapsed-parent dot), `components/SidebarRail.tsx`, `sessionStatus.test.ts`.
**Verification.** Tests for `mostUrgent`: starting child alone gives starting; starting beside idle gives idle; starting beside running gives starting; a failed child beats all; existing orderings unchanged. `npm test`, `npm run typecheck`. Manual: collapse a parent with a starting child.

## Reviewer round log

- Round 1 (3 blocking, 9 non-blocking). Blocking: placeholder spins forever on failure before slice 3 → fixed by removing the placeholder on failure in slice 1; placeholder has no pane and other consumers → fixed by D1 note, slice 1 files and tests, and a risk; re-homing and focus in D2 → fixed by keeping the id and stating the orphan-worktree behaviour.
- Round 2 (3 blocking, 8 non-blocking). Blocking: slices 1-3 release together → stated in slice 1; re-home focus check → added to slice 5 verification; tick unchecked → named `termPoll` (always armed). Applied non-blocking: restart check moved to slice 1, manual-only visuals stated, refusal-message test, dismiss control named, CLI race and quit-during-startup risks, D1 B rejection reason.
- Round 3 (3 blocking, 7 non-blocking). Blocking: whole placeholder must not be saved → slice 1 and state-store test; resume failure must not delete saved history → D4 `session:dismissStartup`, saved copy stays `gone`; resumed session sweeps and stale `status` → slice 4 tests. Applied non-blocking: rail dismiss control named, rail error visual, CLI parity and dialog step, D3 wording, post-timeout status test. D5 (`failed` above `waiting`) is left to the human review.
- CTO check (0 blocking).
- Human review: no vetoes on D1-D5.
- Round 1 non-blocking applied: file named, three agent kinds in manual check, separate `since`, resume failure, worktree seam, restart clears failed cards.

## Deviations from the brief the human should know

- The CLI keeps making worktrees with its own `worktrees.add` before `sessionCreate`; only the app's `session:create` gains the `worktree` input (D2). A CLI start with a new worktree therefore gets its card when the session starts, not during the worktree step.
- Dismissing a failed resume keeps the session (`gone`, resumable) instead of removing it.
- Requests refused before a project is resolved (unknown project, no agent source, bad parent or feature, no sandbox kind) still show only in the dialog or CLI, with no error card, because nothing was created.
- A failed start from the CLI also leaves an error card in the app until dismissed.
- With a new worktree, the card first sits under the source project and then moves to the worktree project.
- `failed` ranks above `waiting` on a collapsed parent (D5).

## Risks and what is deliberately not done

- Moving `preflight` after project resolution (slice 3) changes the order of today's checks; the refusals are the same, only a card now exists in between.
- Placeholder sessions have no pane: any consumer of `slices.sessions` that assumes one (gone detection, kill, activity poll) could mishandle them; slice 1 covers this with tests.
- A CLI-started session races `refreshStatus` and the status-clear; the clear is applied in the same pass that sets `status`, tested in slice 1. Quitting the app during startup drops the placeholder (not saved); the orphan tmux pane is then picked up as today.
- Adding `startup` to `Session` touches every test factory; keep it optional to limit churn, and confirm it is never persisted (no `schemaVersion` bump is planned).
- Re-homing a session between projects (slice 5) is the riskiest step; it is last of the end-to-end slices so earlier slices ship without it.
- Out on purpose (brief non-goals): spinner for restart-restored sessions, retry, phase text, spinner for "working", configurable timeout.

## Open questions
