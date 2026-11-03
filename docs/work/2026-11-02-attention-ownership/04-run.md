---
feature: 2026-11-02-attention-ownership
phase: run
status: draft
version: 1
created: 2026-11-02
updated: 2026-11-02
approved_at:
based_on: [03-plan.md@1]
forced: []
---

# Run: attention ownership and sidebar zones

Profile: inherit
Branch: feature/2026-11-02-attention-ownership-inherit
Plan commit: ed1ea362b9fc9f5b07ad0db24cc04d087b115291
Roles:
- cto: claude, inherit
- researcher: claude, inherit
- planner: claude, inherit
- reviewer: claude, inherit
- implementer: claude, inherit

## Slice 1

Session: attention-ownership-slice-1-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `notifyTransitions` (`src/core/core.ts:589`) notifies on every entry to waiting off screen, for any session. `sessionStatus.ts` has `trackWaiting` and `longestWaiting` filtering on `shownStatus(s) === 'waiting'`; `Sidebar.tsx:247` counts the same way; `mostUrgent` ranks a waiting child above others. `Session.parentId` marks a child.

Implementer 1:
- [x] `src/core/core.ts`: in `notifyTransitions`, skip the popup when `s.parentId` is set and `s.waitingFor === 'done'` (still record `waitKey`)
- [x] `src/renderer/src/sessionStatus.ts`: add `countsAsWaiting(s)` (waiting, and not a child with `waitingFor === 'done'`); use it in `trackWaiting` and `longestWaiting`; make `mostUrgent` rank a finished child as non-urgent
- [x] `src/renderer/src/components/Sidebar.tsx`: `waitingCount` uses `countsAsWaiting`
- [x] tests in `src/core/sessions.test.ts` and `src/renderer/src/sessionStatus.test.ts`

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer found no blocking findings; no fix needed.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: `mostUrgent` ties between a finished child and a plain idle sibling depend on list order; Board, palette, `family.ts`, `workflow/derive.ts`, `tree.ts` and `sessionList.ts` still treat a finished child as waiting (outside "N waiting", popup and cmd+.; not in the plan); the child-and-done predicate is written in both `core.ts` and `sessionStatus.ts`; the core test covers OpenCode and terminal, not Claude or Copilot.

### Deviations

none

### Verification

`npm test` (108 files, 1328 tests) and `npm run typecheck` pass, with new tests for a child's done (no notify; top-level done and a child's permission still notify; terminal child), `countsAsWaiting`, `longestWaiting`, `trackWaiting`, `mostUrgent` and the unchanged finished look. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Observable check: start a parent with `grove new claude --child`, let the child finish, and confirm no popup or sound and an unchanged "N waiting".

## Slice 2

Session: attention-ownership-slice-2-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `Session` live fields (`status`, `waitingFor`) are stripped before save in `core.ts` `set()`; `sessionWorkflowStatus` is the model for a session command (`core.ts`, `ipc.ts`, `src/shared/ipc.ts`); `toCli` in `cliServer.ts` builds `grove ls --json`.

Implementer 1:
- [x] `src/shared/zones.ts`: `zoneOf(session)` (override first; permission, question or unknown wait -> needs-you; finished top-level -> review, finished child -> none; `in-review` -> review; working -> running)
- [x] `src/shared/types.ts`: `Zone`, `Session.zone?` (live), `Session.zoneOverride?` (persisted)
- [x] `src/core/core.ts`: `withZones` on every sessions publish, `zone` stripped before save, `sessionSetZone` (null resets)
- [x] `src/shared/ipc.ts`, `src/main/ipc.ts`: `session:setZone`; `src/shared/cli.ts`, `src/main/cliServer.ts`: optional `zone` in `grove ls --json`
- [x] tests: `src/shared/zones.test.ts`, `src/core/sessions.test.ts`, `src/renderer/src/sessionStatus.test.ts`

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer found no blocking findings; no fix needed.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: no automated test of `zone` in `grove ls --json` (trivial `toCli` change); an override also wins on gone or starting rows (slice 3 may hide it there). The `countsAsWaiting` unchanged-by-override assertion the reviewer asked for is in `sessionStatus.test.ts`.

### Deviations

none

### Verification

`npm test` (109 files, 1339 tests) and `npm run typecheck` pass. Tests cover each zone rule, override precedence, unknown input -> needs-you, `countsAsWaiting` and `notify` unchanged by an override, `zone` absent from the state file, and the override kept across a restart and cleared by a reset. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Observable check: `grove ls --json` shows `zone` per session (not run in the app here); an override set through `session:setZone` is in the state file after an app restart (covered by the core test, not run through the UI).

## Slice 3

Session: attention-ownership-slice-3-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: the sidebar is one 675-line `Sidebar.tsx` (project groups from `listGroups`, `SessionCard`, drag, options panel, a `N waiting` button); `zoneOf` and `Session.zone` (slice 2) are on every session; `sessionSort` defaults to `custom` in `DEFAULT_UI` (`types.ts`) and `loadState` spreads saved values over it, so a changed default reaches fresh state only. The Claude `UserPromptSubmit` hook record carries `prompt` (`claude/normalise.ts:87` drops it); `AgentEvent` has no prompt event; `core.ts` `onEvent` (~:624) is the one place events reach sessions. `Session.lastLine?` and `UiState.sidebarView?` are added to `types.ts` up front, and the default sort is `viewed-desc`.

Implementer 1 (data: last prompt line):
- [x] `src/core/agents/types.ts`: add `{ type: 'prompt'; sessionId: string; text: string }` to `AgentEvent`
- [x] `src/core/claude/normalise.ts`: emit it on `UserPromptSubmit` when `prompt` is a string; check `copilot/normalise.ts` and `opencode/normalise.ts` for prompt text in their records and emit the same event where it exists, else record in a code comment that it has none
- [x] `src/core/core.ts`: in `onEvent`, store the first line of `text` (trimmed, cut at 120) as `Session.lastLine` for that session and publish; ignore blank text; persisted (not stripped on save)
- [x] tests beside the normalisers and in `src/core/sessions.test.ts`: the event, the cut, persistence in the state file

Implementer 2 (renderer: zones view):
- [x] `src/renderer/src/zoneList.ts` (new, pure): `zoneSections(sessions, now?)` returning needs-you, review, a running count (working sessions, top-level and children), and `recent` (about 5 by `lastFocusedAt` desc, never-focused left out, none already in another zone or counted as a row, a session once); a finished child is no row; a child is a row only in needs-you; `rowTitle(s)` (a session whose label still has the default pattern `Terminal · HH:MM` / `Claude · HH:MM` / `OpenCode · …` / `Copilot · …` shows `lastLine` as the title when set) and `rowLine(s)` (`lastLine`, else label and status text)
- [x] `src/renderer/src/zoneList.test.ts`
- [x] `src/renderer/src/components/ZoneSection.tsx` (new): a titled section of rows (title, one line, status dot, click focuses); Running (handled) collapsed to a count that opens to its rows; run-parent card keeps the existing collapsed children line (`N children, M done`) in both views
- [x] `src/renderer/src/components/Sidebar.tsx`: Zones/Projects toggle in the header, zones the default (`ui.sidebarView !== 'projects'`), persisted through `ui:set`; the existing project tree unchanged in Projects view; the default-name title rule applied in the project tree's cards too; context menu "Move to zone" (Needs you, Ready to review, Running, Reset) over `session:setZone`
- [x] `src/core/ipc` or `ui:set` handling: confirm `sidebarView` passes through `ui:set` (add to any whitelist)

Models passed: implementer: inherit, reviewer: inherit
### Review rounds

Round 1: blocking: the run parent's children line was a static span in the zones view, not expandable (plan: opens to the children in both views). Fix: a toggle on the shared `ui.collapsed` + `kidsKey` mechanism with child rows, `childrenSummary` ("N children, M done") in both views. Also fixed: "Move to zone" offered Ready to review for a child (`zonesFor`), and a default-named row repeated its title as its line. Result: Verification passes.
Round 2: fresh reviewer, no blocking findings.

Approved, 1 blocking in round 1, 1 fix round. Non-blocking left: children are open by default in the zones view (shared key with the tree); no renderer test for the toggle itself; a waiting child shows both in Needs you and under its parent; a parent with no zone and no `lastFocusedAt` has no zones-view row (Projects still shows it); shift-click range skips kid and Running rows; `recent` includes gone sessions; a slash command or injected message sent as a prompt can become `lastLine`; Copilot's `prompt` field is verified only from fixtures; the `sessionSort` default is set in `DEFAULT_UI`, so only fresh state gets it.

### Deviations

- The `viewed-desc` default sits in `DEFAULT_UI` (`types.ts`), not `stateStore.ts` (equivalent: saved values win, fresh state gets the new default).
- A new `prompt` `AgentEvent` (ignored by `status.apply` and the change tracker) carries the prompt text; OpenCode has none, so its rows keep label and status text.
- Run-parent children open by default in zones view, matching the project tree.

### Verification

`npm test` (110 files, 1352 tests) and `npm run typecheck` pass. New tests cover `zoneList` (grouping, the collapsed running count, five-most-recent, no duplicates, title and line rules, `zonesFor`), `childrenSummary`, the `prompt` event for Claude and Copilot, and `lastLine` (first line, cut at 120, blank ignored, in the state file, kept after reload). Models requested: implementer inherit, reviewer inherit.

### Left for the human

Run the app: zones appear in order, the toggle returns to the project tree, a session in Needs you is not also under Where you were, a default-named session shows its last-prompt line as title and keeps it across a reload, after a restart the same five sessions and lines show, "Move to zone" changes a row and keeps it after restart, and the children line opens to the children. Not checked: the look of the new CSS.

## Slice 4

Session: attention-ownership-slice-4-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `grove` commands go CLI (`src/cli/args.ts`, `index.ts`) -> `CliMethods` (`src/shared/cli.ts`) -> `dispatch` in `src/main/cliServer.ts` -> `core.commands`. Live fields (`status`, `waitingFor`, `zone`) are stripped in `core.ts` `set()` before save. `notifyTransitions` records `waitKey` and fires the `notify` listeners; `src/main/index.ts:118` builds the popup body from `BODY[waitingFor]`. `zoneOf` already puts a permission or question wait in needs-you. `rowLine` (`zoneList.ts`) is the row's second line; `childrenSummary` (`family.ts`) is the parent's children line, rendered in `ZoneSection.tsx` and the `SessionCard` meta in `Sidebar.tsx`. `Session.attention` and `Session.progress` (live) are added to `types.ts` up front. An escalation records the `waitingFor` it was made on and is dropped in `set()` once the session is not waiting on that.

Implementer 1 (core and CLI):
- [x] `src/cli/args.ts`: `escalate <ref> <reason>` and `progress <ref> <done>/<total>` (non-empty reason; integers, total >= 1, done <= total), usage text; `src/cli/args.test.ts`
- [x] `src/shared/cli.ts`: `sessions.escalate`, `sessions.progress`; `src/cli/index.ts` calls them; `src/shared/sessionErrors.ts`: `not-waiting`
- [x] `src/core/core.ts`: commands `sessionEscalate` (only a session waiting on a permission or question, else `not-waiting`; reason first line, cut at 200; no popup if one already fired for that wait, otherwise fire `notify` once with the reason on the session unless it is on screen) and `sessionProgress`; `attention` and `progress` stripped before save; `attention` dropped in `set()` when the session stops waiting or waits on something else
- [x] `src/main/cliServer.ts`: dispatch both (`bad-params`, `not-found`, `not-waiting`); `src/main/index.ts`: popup body is `s.attention?.reason` when set
- [x] `src/shared/zones.ts`: a waiting session with an attention reason is in needs-you
- [x] tests: `src/main/cliServer.test.ts`, `src/core/sessions.test.ts`, `src/shared/zones.test.ts`

Implementer 2 (renderer):
- [x] `src/renderer/src/zoneList.ts`: `rowLine` of a waiting session is its attention reason, else "Needs permission" / "Has a question"
- [x] `src/renderer/src/family.ts`: `runProgress(parent, kids)` (the declared progress and the children marked done, null when none declared) and its label ("4 of 8 slices done, 3 children done")
- [x] `src/renderer/src/components/RunProgress.tsx` (+ css module): a bar and label, used in `ZoneSection.tsx` rows and the `Sidebar.tsx` `SessionCard` meta for a parent with `progress`
- [x] tests: `src/renderer/src/zoneList.test.ts`, `src/renderer/src/family.test.ts`

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer found no blocking findings; no fix round.

Approved, 0 blocking, 0 fix rounds. Cheap non-blocking applied: escalate now also sets `waitKey`, so a later `notifyTransitions` cannot pop a second time for the same wait. Left: the progress bar in the project-tree card shares the nowrap `branchLine` row with the kids toggle and branch (may be cramped; not seen in the app); a reason starting with `-` needs `--`; `notified` entries of a session removed while waiting linger; a child going straight from one permission prompt to another keeps the old reason; `grove progress` is accepted on any session and stays until restart.

### Deviations

- The progress bar shows only when a parent declared progress; the children-done-out-of-children-seen fallback is not built (it would put a bar on every ordinary parent). The label is "N of M slices done" (plus ", K children done"), not "Slice N of M".
- The `zoneOf` attention rule is a no-op today (permission and question waits are already needs-you); kept as the plan lists it.

### Verification

`npm test` (110 files, 1364 tests) and `npm run typecheck` pass. New tests: CLI parsing for both commands; `sessions.escalate` (not-waiting, not-found, bad params) and `sessions.progress` (valid, and 5/4, 0 total, negative, fractional rejected); core: an escalation after a popup adds the reason with no second notify, an away child gets exactly one notify, an on-screen child none, the escalation clears when the wait ends and a later prompt notifies without the old reason, neither field is saved, a working session cannot be escalated; `zoneOf` for an escalated child; `rowLine` reason and both fallbacks; `runProgress`. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Run the app: `grove escalate <child> "asks to drop the table"` on a child waiting on a permission shows that text in Needs you (one popup in total for that prompt) and exits non-zero on a working child; `grove progress <parent> 4/8` shows the bar in both views. Not checked: the look of the bar in the project-tree card.

## Slice 5

Session: attention-ownership-slice-5-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `notifyTransitions` (`src/core/core.ts:611`) pops on first sight of a waiting status and records `waitKey`/`notified`; `sessionEscalate` (~:1090) sets the live `attention` and relies on `notified`/`waitKey`. `set('sessions')` runs `withZones(dropStaleAttention(...))` and strips live fields before save (:256). `countsAsWaiting` and `shownStatus` live in `src/renderer/src/sessionStatus.ts`; `zoneOf` in `src/shared/zones.ts`. `grove send` goes CLI (`src/cli/index.ts:25`) -> `sessions.send` (`src/shared/cli.ts:12`, `src/main/cliServer.ts:113`) -> `commands.sendToSession`, with no caller identity. `ConfigFile` is rewritten at `core.ts:247` from `configWorkflow`/`configSounds`, so a new field must be kept there. `ZoneSection.tsx` renders parent cards with a children line and `RunProgress`.

Implementer 1 (core, CLI, config, shared; no renderer files):
- [x] `src/shared/types.ts`: `ConfigFile.escalateAfterSec?: number`; live `Session.held?: boolean`; live `Session.handled?: HandledPrompt[]` with `HandledPrompt = { childId, at (ISO), kind: 'permission' | 'question', screen (last 8 lines), sent }`
- [x] `src/core/core.ts`: read `escalateAfterSec` at start (default 60, 0 = off), keep it in the config rewrite; in `notifyTransitions` hold a child's (has `parentId`) permission or question: set `held`, capture the last 8 lines of the pane, start one timer per child; on expiry, if still on that wait, clear `held` and notify as before (unless escalated); a top-level session and `escalateAfterSec` 0 notify at once; `held` and `handled` stripped before save; held cleared when the wait ends
- [x] `src/core/core.ts`: a note-send hook (`noteSend(id, text, fromSessionId)`): when the target is held and the caller id equals its `parentId`, remember the text; when the wait then clears inside the window, append a `handled` entry to the parent (when, kind, screen, text); a clear with no such send adds nothing; `sessionEscalate` ends the hold and notifies at once
- [x] `src/shared/zones.ts`: a held child is `running`, not needs-you
- [x] `src/shared/cli.ts`, `src/cli/index.ts`, `src/main/cliServer.ts`: `grove send` passes `process.env.GROVE_SESSION_ID` as `from`; the server resolves it and passes it to core
- [x] tests in `src/core/sessions.test.ts` (fake timers) and `src/shared/zones.test.ts`, plus CLI arg or server tests where they exist

Implementer 2 (renderer; types from implementer 1 as above):
- [x] `src/renderer/src/sessionStatus.ts`: `shownStatus` returns `working` for a held session, so `countsAsWaiting`, cmd+., the dots and `mostUrgent` follow
- [x] `src/renderer/src/components/ZoneSection.tsx` (+ css): a parent card shows a handled badge with `handled.length`; opening it lists time, kind, the screen tail and the sent text per entry; Running (handled) heading counts working sessions as before
- [x] tests in `src/renderer/src/sessionStatus.test.ts` (and a component test if the folder has them)

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: fresh reviewer found no blocking findings; no fix needed.

Approved, 0 blocking, 0 fix rounds. Non-blocking left: `zoneList.ts` `rowLine` and `workflow/derive.ts` read raw `status === 'waiting'`, so a held child shows its prompt subtitle and turns a feature card to waiting for up to the window; the expiry notify lacks the `id !== lastOnScreen` check that escalate has; only the last text of several sends in one hold is recorded; `dropSessions` does not end a hold early (bounded by the window); `escalateAfterSec` above the `setTimeout` 32-bit limit fires at once; `handled` is live-only and unbounded; the screen capture is asynchronous, so a very fast clear can record an empty screen.

### Deviations

`commands.sendToSession` takes an optional `from` instead of a separate `core.noteSend`. The hold is skipped when the child is on screen or not primed (neither notified before). `handled` and `held` are live only. The handled list opens as an inline list, not a floating popover. No component test for the badge: the repo has no `.test.tsx` and vitest only includes `src/**/*.test.ts`. The existing child-permission test now advances fake timers past the window.

### Verification

`npm test` (110 files, 1374 tests) and `npm run typecheck` pass. New fake-timer tests: a send from the parent within the window gives no notify and one handled entry with screen tail and text; a clear with no send adds none; an unanswered prompt notifies once after the window and not before; a send from a non-parent adds none; escalate still notifies at once; held and handled are not saved; `escalateAfterSec` survives a config rewrite; 0 turns the hold off. Plus zones, `sessionStatus`, args and cliServer tests. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Observable check: with a child on a permission prompt, it shows in Needs you with a popup only after the window passes; and a parent's `grove send` answer inside the window shows in its handled badge. Not run here (needs the app).

## Slice 6

Session: attention-ownership-slice-6-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `resources/skills/grove/SKILL.md` documented `wait` exit 4 as "report and wait for the human" and had no `escalate`/`progress`. The grove-run skill lives at `~/.claude/skills/grove-run` outside the repo. `core.waitTurn` reads status directly (so exit 4 is not delayed by the hold), and slice 4/5 already give `sessionEscalate`, `sessionRead`, `sendToSession({from})` and the `handled` record; `sessions.test.ts` has the grace-window harness.

Implementer 1:
- [x] `resources/skills/grove/SKILL.md`: `escalate` and `progress` commands, the wait-read-decide-re-read-send loop, routine list, never-answer list, unsure means escalate
- [x] `resources/skills/grove-run/` (copy of the skill), step 3: bounded `grove wait`, exit 4 handling pointing at the grove skill, `grove progress` after each slice, exceptions to the never-`send` rules
- [x] `src/core/sessions.test.ts`: scripted parent loop (wait returns blocked at once while held, routine answered and recorded as handled, destructive escalated with a reason, one popup) and a non-routine-sends-nothing case

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: 2 blocking (grove-run text contradicted itself on "no wait loop" and "never send into a waiting child"; routine list too loose: no argument, secrets or path guards). Fixed in the skill texts, test regex tightened to whole-command matches.
Round 2: fresh reviewer confirmed both fixed, 0 blocking.

Approved, 0 blocking, 1 fix round. Non-blocking left: grove-run still names the branch `feature/<slug>-<profile>` while AGENTS.md says `run/...` (pre-existing); "End the turn" step heading ordering is loose; the in-repo grove-run copy and `~/.claude/skills/grove-run` (a symlink to a separate repo) are now two sources; the tests use a regex stand-in for the parent's judgement, so they cover the plumbing, not the safety text; the re-read mismatch branch is not exercised.

### Deviations

The slice was built directly by the planner session rather than through an `implementer` subagent (text edits and one test). The `grove-run` copy in `resources/skills/` is a copy only: it has to be installed by the human before a real run uses it.

### Verification

`npm test` (110 files, 1376 tests) and `npm run typecheck` pass, including the scripted parent loop. Models requested: reviewer inherit.

### Left for the human

Install the copied `grove-run` text, then the real run in a scratch repo with a two-slice plan (routine permission answered by the parent and counted as handled with no popup; destructive one in Needs you with the parent's reason and a popup).

## Slice 7

Session: attention-ownership-slice-7-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `zoneOf` (`src/shared/zones.ts`) sends a top-level `waitingFor: 'done'` session to review; `set('sessions')` in `core.ts` runs `withZones(dropStaleAttention(stampStatusAt(..)))`, so a live field tied to one idle period can be dropped there, keyed on `statusAt`. `Session.lastLine` is persisted and already shown by `rowTitle`/`rowLine` in `zoneList.ts`. The config is held as written (`configEscalate`) and re-saved in `set('projects')`; `ConfigFile` lacked `classifier`. `backend.capture(name, lines)` gives the screen tail. `src/main/index.ts` builds the core options (`prLookup` via `ghLookup`/`findBin`); `src/core/pr.ts` is the model for an `execFile` runner. No classifier existed.

Implementer 1:
- [x] `src/core/classifier.ts` (new): prompt builder, `parseVerdict` (garbled or empty -> needs-you), injectable `Runner`, `createClassifier` (missing binary -> off, over the cap -> abandoned), `claudeRunner`
- [x] `src/shared/types.ts`: `ConfigFile.classifier`, live `Session.classified`
- [x] `src/shared/zones.ts`: a classified needs-you top-level finished session is needs-you
- [x] `src/core/core.ts`: `classifierRun` option, config read and kept, `classified` stripped before save and dropped with its idle period, `pumpClassifier` (one in flight, tried map), summary into `lastLine`
- [x] `src/main/index.ts`: pass the runner when `claude` is found
- [x] `src/renderer/src/zoneList.ts`: "May need an answer" fallback line
- [x] Tests: `classifier.test.ts`, `zones.test.ts`, `zoneList.test.ts`, `sessions.test.ts`

Models passed: implementer: inherit, reviewer: inherit

### Review rounds

Round 1: 1 blocking: `claude -p` ran with the user's tools and settings, so screen text was not only data. Fixed with `--tools "" --no-session-persistence --setting-sources ""` (argv test added). Also fixed from the same review: fence markers neutralised in the screen tail, the tmux capture put under the 20 s cap, config validated (boolean `enabled`, safe `model`), `classifyTried` pruned on session removal, tests for `rowLine` and a hung runner.
Round 2: fresh reviewer: no blocking findings.
Round 3 (header fix, after the slice was reported): the sidebar header did not fit at a narrow width, so the "Sessions" heading was replaced by a 20 px accent tree logo (`role="img"`, `aria-label="Grove"`) and the logo, toggle and add button made non-shrinking (about 198 px of 220 px at the minimum). Fresh reviewer: no blocking findings. Not checked in the running app.
Round 4 (quiet children, after the slice was reported): several screens still read the raw waiting status, so a finished child or a held child prompt looked waiting. A shared `asksHuman` (`src/shared/attention.ts`) now backs `countsAsWaiting`, with a `queueStatus` helper; routed through it: Board feature card, palette `waiting`, `family.ts` ranking, session board columns (`tree.ts`), `sessionList.ts` status-age sort, `workflow/derive.ts` card state and `zoneList.ts` `rowLine`. Finished children keep their look (`statusView`/`statusTone` untouched). Tests added for each consumer. Fresh reviewer: no blocking findings; cheap non-blocking applied (`rowLine` keeps strict old behaviour for top-level sessions, stale `family.ts` comment). Behaviour change to know: a finished child now ranks with idle in `familyOf`, so the jump target is a working child first. No `Board.tsx` component test exists; its check is covered through `countsAsWaiting`.
Both fixes landed in slice 7's commit (amended; still one commit per slice).

Approved, 1 blocking in round 1, 1 fix round before the report (rounds 3 and 4 were fixes after review). Non-blocking left: a quoted `"enabled": "false"` still counts as on (D3 says default on); the 20 s cap applies per phase (capture, then model), so about 40 s worst case; a failed or timed-out call is not retried within one finish; after a restart every finished-unseen top-level session is classified again, one at a time; a prompt-injected screen can still steer the model to `done` (residual risk named in the plan). Cheap ones applied: summary control characters stripped, env comment corrected.

### Deviations

none. `ZoneSection.tsx` and `configStore.ts` were not changed: the summary reaches the row through `rowLine` (which `ZoneSection` renders) and `configStore` passes `classifier` through.

### Verification

`npm test` (112 files, 1412 tests) and `npm run typecheck` pass. The classifier flags with empty values were run once against the real `claude` and accepted. Models requested: implementer inherit, reviewer inherit.

### Left for the human

Observable check in the app: end a Claude session on "which of these two do you want?" and see it in Needs you with a summary line; with `classifier.enabled: false` or no `claude` on the path, nothing is sent, no error shows and rows keep their last-prompt line.

### Fix after review

Comment: the sidebar header did not fit at a narrow width (the add-folder button was clipped); replace the "Sessions" heading with a small logo mark so the logo, the Zones/Projects toggle and the add button always fit on one row down to the minimum sidebar width.
Changed: `Sidebar.tsx` swaps the `<h2>Sessions</h2>` for a 20 px one-colour inline SVG tree (`role="img"`, `aria-label="Grove"`, accent colour); `Sidebar.module.css` replaces `.heading` with `.logo` and makes the logo, toggle and add button non-shrinking (toggle no-wrap). Width at the 220 px minimum: 24 padding + 20 logo + 114 toggle + 24 button + 16 gaps = 198 px, so about 22 px spare.
Verification re-run: `npm test` (1398 tests) and `npm run typecheck` pass; a fresh reviewer found no blocking findings. Not checked in the running app (computed from the tokens and the monospace font width).

Comment 2: finished children must read as quiet everywhere, not only in the count, popup and cmd+; a held child prompt must not make a feature card or the Board show waiting.
Changed: see Review rounds, round 4 (`asksHuman`, `queueStatus`, eight consumers rerouted, tests for each).
Verification re-run: `npm test` (112 files, 1412 tests) and `npm run typecheck` pass; a fresh reviewer found no blocking findings. Both fixes are in this one slice commit.

## Final summary

- Slice 1: `2026-11-02-attention-ownership: slice 1 — Clean-finished children go quiet`: a finished child gives no popup, sound or count; top-level behaves as before. Review: approved, 0 fix rounds. Deviations: none.
- Slice 2: `2026-11-02-attention-ownership: slice 2 — Zone derivation and manual override`: one `zoneOf` rule set, persisted override, `zone` in `grove ls --json`. Review: approved, 0 fix rounds. Deviations: none.
- Slice 3: `2026-11-02-attention-ownership: slice 3 — Zones sidebar with a Projects toggle`: zones view, toggle, recent list, row titles and `lastLine`, move to zone. Review: approved, 1 fix round. Deviations: `viewed-desc` default sits in `DEFAULT_UI`.
- Slice 4: `2026-11-02-attention-ownership: slice 4 — Parent declarations: escalate and progress`: `grove escalate` and `grove progress`, reasons on rows, progress bar. Review: approved, 0 fix rounds. Deviations: the children-seen progress fallback is not built; label is "N of M slices done".
- Slice 5: `2026-11-02-attention-ownership: slice 5 — Grace window and the handled record`: 60 s hold for child prompts, handled audit. Review: approved, 0 fix rounds. Deviations: `sendToSession` takes `from`; hold skipped when on screen or not primed.
- Slice 6: `2026-11-02-attention-ownership: slice 6 — Parents answer routine prompts`: routine and never-answer lists and the wait-read-decide-send loop in the skill texts. Review: approved, 1 fix round. Deviations: built directly by the planner; the `grove-run` copy must be installed by the human.
- Slice 7: `2026-11-02-attention-ownership: slice 7 — Small model: ambiguous sessions and one-line summaries`: a finished unseen top-level agent session is read once by `claude -p` (no tools, no persistence, no settings); a question verdict moves it to Needs you and its summary becomes the row line. Review: approved, 1 fix round, plus the header and quiet-children fixes (all in this commit). Deviations: none.

### Left for the human

The in-app observable checks listed per slice (none run in the app here), install the copied `grove-run` text and do the two-slice scratch-repo run from slice 6, and the slice 7 check: a session ended on a question appears in Needs you with a summary; with `classifier.enabled: false` or no `claude`, nothing is sent.

### PR description

Attention ownership and sidebar zones

Children no longer pull the human's attention when their parent owns it. Slice 1: finished children are quiet. Slice 2-3: zones (Needs you, Ready to review, Running) with a manual override, a Zones/Projects toggle and readable row titles. Slice 4: `grove escalate` and `grove progress`. Slice 5: a 60 s grace window for child prompts and a handled audit. Slice 6: parents answer routine prompts under a written list and escalate the rest. Slice 7: a small model (`claude -p`, no tools) reads finished unseen top-level sessions, moves ones that stopped on a question to Needs you, and supplies a one-line summary; `classifier.enabled: false` turns it off.

Verified with `npm test` and `npm run typecheck`. Left for the human: the in-app checks per slice and the real two-slice run from slice 6.

## Open questions
