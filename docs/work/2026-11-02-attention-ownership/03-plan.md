---
feature: 2026-11-02-attention-ownership
phase: plan
status: approved
version: 1
created: 2026-11-02
updated: 2026-11-02
approved_at: 2026-11-02
based_on: [01-outcome.md@1, 02-research.md@1]
forced: []
---

# Plan: attention ownership and sidebar zones

## Decisions

### D1. How Grove knows a parent is handling a child's prompt

**Context.** A child's permission or question prompt must stay out of "Needs you" and silent while its parent agent deals with it, yet appear (with a popup) when the parent cannot or will not. Today a parent only learns of a child's prompt by blocking in `grove wait` (exit 4), and the app has no idea the parent is doing so.

**Options.**
- A. Grace window. A child's prompt is held for a short time (default 60 s, a `config.json` setting) before it counts as Needs you and notifies. The parent can end the wait early with `grove escalate <child> "<reason>"`, which moves the child to Needs you at once with that reason. Pros: works for every agent kind with no change to the agents; a crashed or forgetful parent can never hide a prompt for longer than the window; deterministic. Cons: a real blocker waits up to the window before the human hears of it unless the parent escalates; one more setting.
- B. Explicit claim. The parent must run `grove claim <child>` for each prompt it will handle; anything unclaimed surfaces at once. Pros: no delay for unhandled prompts. Cons: every parent skill must call it correctly; a parent that forgets floods Needs you, a parent that claims and then stalls hides the prompt indefinitely.
- C. No handling. Every child prompt goes to Needs you at once. Pros: simplest, nothing can be hidden. Cons: does not meet the brief; the noise stays.

**Pick:** A

**Human review.** The human accepted the 60 s hold against the brief's "stays counted" line (2026-11-02).

**Scope.** The hold applies only to a child (a session with a parent); a top-level session's prompt notifies at once, as today. `escalateAfterSec` is a `config.json` setting; 0 turns the hold off. The parent's `grove wait` is not affected: it reads status directly (`cliOps.ts:102-106`), so the parent still hears of a prompt at once.

**Outcome impact.** The human is never pinged for a prompt the parent resolves inside a minute, and never waits longer than a minute for one it does not. This is a deliberate narrowing of "a child asking a permission or question stays counted" (see Deviations).

### D2. Who decides what a parent may answer alone

**Context.** The brief lets a parent answer routine permission prompts and obvious either/or questions, and requires escalation for new kinds of permission, trade-offs, design choices, destructive actions and anything uncertain. Whoever decides can approve an action on the human's behalf, so this is the safety-critical choice.

**Options.**
- A. Parent agent judgment under a written routine list. The `grove` and `grove-run` skills carry an explicit list of what counts as routine (read-only commands, edits inside the run worktree, the project's own test, typecheck and build commands, naming or ordering questions the plan already answers) and a rule to escalate on anything else or on doubt. Pros: handles questions as well as permissions; adapts to the plan; no new app code. The skills also carry a never-auto-answer list (deleting or overwriting outside the worktree, force-push, anything touching the network or installing packages, credentials, spending money) that always escalates. Cons: enforced by a model reading a list, not by code; a wrong call is possible and shows only in the audit.
- B. App-enforced allowlist. The app matches a child's prompt against patterns and answers only on a match. Pros: deterministic and auditable. Cons: the app cannot see the content of every prompt today (permission details are not carried through the status events); cannot judge "obvious either/or"; large new surface per agent kind.
- C. No auto-answering; the grace window only hides prompts the child resolves itself. Pros: nothing is ever approved on the human's behalf. Cons: parents stop at every prompt, so Needs you stays long.

**Pick:** A

**Outcome impact.** Routine prompts disappear from the human's list; a mistaken approval is possible, and the handled count and Running (handled) audit (slice 5) are the check on it.

### D3. How the small fast model is called

**Context.** The brief wants ambiguous finished sessions (for example one that stopped by asking a question in prose) judged by a small fast model, and one-line summaries for rows. Grove today launches agents in tmux and makes no model calls of its own, and holds no API key.

**Options.**
- A. Headless agent CLI. Grove runs the user's own `claude -p --model <alias>` with the tail of the session screen as input and parses a short answer. Pros: reuses the human's existing login; no key to store; model is a setting. Cons: needs `claude` on the path; each call spawns a process; only Claude's CLI is covered at first.
- B. Direct API call from the app. Pros: faster, no process spawn. Cons: needs an API key stored and configured; new network surface in the app; a new credential to manage.
- C. Leave ambiguous cases to the human (no classifier). Pros: nothing new to build or trust. Cons: a session that stopped on a prose question looks like a normal finish and sits in Ready to review, so the human can miss that it needs an answer; summaries stay as labels.

**Pick:** A

**Data.** The last 40 lines of a session's screen are sent to the model through the human's own `claude` login, the same provider the session already talks to. Screen text can contain third-party content and may include secrets shown in the terminal, so it is treated as data in the prompt and never as instructions, and `classifier.enabled: false` is the opt-out. Child sessions are never classified; only finished top-level agent sessions are. `config.json` `classifier.enabled` (default on) and `classifier.model` control it, and turning it off sends nothing.

**Outcome impact.** Sessions that stopped on a question reach Needs you, and rows get a one-line summary, with no new credential. If `claude` is missing the feature switches itself off and rows fall back to the label.

### D4. Names and shapes of the new `grove` commands

**Context.** Parents declare things to the app through the `grove` CLI, which skills and scripts will call for years, so names and arguments are hard to change later.

**Options.**
- A. Two verbs: `grove escalate <ref> <reason>` (marks a session as needing the human) and `grove progress <ref> <done>/<total>` (declares run progress). Pros: each reads as what it does; easy to document in the skill. Cons: two commands to learn.
- B. One verb with a subcommand: `grove attention <ref> escalate|progress ...`. Pros: one entry point. Cons: harder to read in a skill; mixes two unrelated things.
- C. Reuse `grove status <ref> <workflow status>` by adding `needs-you`. Pros: no new command. Cons: workflow status is a manual label by design and independent of live state; progress and the reason text do not fit it.

**Pick:** A

Slice 2 also adds an optional `zone` field to `grove ls --json` with the fixed values `needs-you`, `review` and `running` (absent for a session in no zone); it is additive, so existing scripts keep working.

**Outcome impact.** A parent can say "I need the human, because X" and "slice 4 of 8" in one short command each.

### D5. What a manual zone override does

**Context.** The brief says the human can move a session to another zone and it stays there. A session moved out of Needs you could hide a real prompt.

**Options.**
- A. The override moves only where the row is shown. It stays until the human resets it (a "Reset zone" menu item), survives restarts, and does not change popups, sounds, "N waiting" or cmd+., which keep following the session's real state. Pros: honors "stays there" without ever silencing a real prompt. Cons: a session can be counted as waiting while shown in another zone.
- B. The override also removes the session from counts, popups and cmd+. Pros: fully obeys the human. Cons: a forgotten override hides a blocker.
- C. The override clears itself when the session next changes state. Pros: never goes stale. Cons: does not "stay there" as the brief says.

**Pick:** A

**Outcome impact.** The human can tidy the sidebar as they like, and a prompt can still never be hidden by a forgotten override.

## Slices

### Slice 1. Clean-finished children go quiet

**Outcome.** A child session that finishes keeps its finished look on its own row but gives no popup or sound, is not counted in "N waiting", and is skipped by cmd+. A top-level session behaves exactly as today. A child's permission or question still notifies and counts.
**Thin end-to-end:** core notification decision -> main-process popup and sound -> renderer count and cmd+. cycle. Deliberately missing: zones, escalation reasons, the grace window for child prompts and anything shown as "handled".
**Files.** `src/core/core.ts` (`notifyTransitions`: skip when the session has a `parentId` and `waitingFor` is `done`, for every session kind including terminals), `src/renderer/src/sessionStatus.ts` (one shared helper `countsAsWaiting(session)` used by `trackWaiting`, `longestWaiting` and the count, so they cannot drift), `src/renderer/src/components/Sidebar.tsx` (the `N waiting` count at ~:247 and :581-584 use the helper; check the collapsed parent's `mostUrgent` dot at ~:84 so a finished child no longer reads as urgent), `src/core/sessions.test.ts` (the `core seen and notify` block), `src/renderer/src/sessionStatus.test.ts`.
**Verification.** `npm test` and `npm run typecheck` pass, with new tests: a child's `done` raises no `notify` event while a top-level `done` and a child's `permission` still do; `longestWaiting` skips a finished child; the count excludes it; the finished child's `shownStatus` is unchanged (it keeps its finished look); a terminal child behaves the same. Observable: start a parent with a `grove new claude --child` session, let the child finish, and see no popup or sound and an unchanged "N waiting".

### Slice 2. Zone derivation and manual override

**Outcome.** Every session has a zone (Needs you, Ready to review, Running handled, or none), worked out in one place by rules, and the human can set an override that always wins and survives restarts.
**Files.** `src/shared/zones.ts` (pure function: permission or question -> needs-you, for children too until slice 5 adds the hold; top-level finished-unseen, or workflow status `in-review` -> review; a working session, top-level or child -> running; a finished child belongs to no zone and keeps its finished look under its parent; the override first), `src/shared/types.ts` (`Session.zoneOverride?`, persisted, optional so no state migration; the override changes only where a row is shown, per D5), `src/core/core.ts` (`sessionSetZone` command with a reset, `zone` stamped on each session slice and added to the live fields stripped before save at ~:251), `src/shared/ipc.ts` and `src/main/ipc.ts` (`session:setZone`), `src/main/cliServer.ts` (zone in `grove ls --json`), `src/shared/zones.test.ts`, `src/core/sessions.test.ts`.
**Verification.** `npm test` and `npm run typecheck` pass; `zones.test.ts` covers each rule, the override precedence, that unknown or unsure input yields needs-you, and that an override does not change `countsAsWaiting` or what `notifyTransitions` fires; a core test checks `zone` is not written to the state file; a top-level session that finished lands in review, a working one in running. Observable: `grove ls --json` shows a `zone` per session, and an override set through the new IPC channel is still in the state file after an app restart.

### Slice 3. Zones sidebar with a Projects toggle

**Outcome.** The sidebar opens on zones: Needs you and Ready to review always open, Running (handled) collapsed to a count of working sessions (top-level and children; each parent card also carries its own handled-prompt badge from slice 5), Where you were listing about 5 recent sessions not already shown in another zone (a session appears once; never-focused sessions are left out). Children are not rows of their own: a run parent's card carries a collapsed line such as "8 children, 8 done" that opens to the children with their finished or working look, in both views; a child appears as its own row only when it needs the human. A Zones/Projects toggle switches to the existing project tree, which defaults to newest first (the `sessionSort` default in `UiState`, set to `viewed-desc` in `src/core/store/stateStore.ts` and used by `src/renderer/src/sessionList.ts`). Every row shows a readable title and one line saying what it was doing. A session still carrying a default name (`Terminal · 14:47`, `Claude · 09:49`) shows that line as its title in both views, without renaming it; the line is the first line of the last prompt the human sent when Grove has it (the Claude spool's `UserPromptSubmit` record carries the prompt text; its presence for Copilot and OpenCode is checked in this slice), else the label and status text. The line is kept on the session (`Session.lastLine?`, persisted, first line only and cut at 120 characters, since prompt text may hold secrets; see Risks) so it is there after a restart. The human can move a session to another zone from its context menu.
**Files.** `src/shared/types.ts` (`UiState.sidebarView?: 'zones' | 'projects'`, absent reads as zones), `src/renderer/src/components/Sidebar.tsx` (toggle, zone sections), `src/renderer/src/components/ZoneSection.tsx` (new), `src/renderer/src/zoneList.ts` (new: pure grouping and "recent" from `lastFocusedAt`, and the row title rule), `src/core/claude/normalise.ts` and the other sources' normalisers (surface the last prompt's first line), `src/shared/types.ts` (`Session.lastLine?`), the context menu in `Sidebar.tsx` (move to zone), `src/renderer/src/zoneList.test.ts`, `sidebarView` and `lastLine` are optional and read as zones and none when absent, so no state migration is needed; other consumers that read the sidebar list (`Board.tsx`, `SessionsBoard.tsx`, `tree.ts`, `paletteItems.ts`, `family.ts`) are checked and left on the project list.
**Verification.** `npm test` and `npm run typecheck` pass; `zoneList.test.ts` covers grouping, the collapsed handled count and the five-most-recent rule. Observable (run the app): with a mix of waiting, finished and working sessions the zones appear in order, the toggle returns to the project tree, a session in Needs you does not also appear under Where you were, a default-named session shows its last-prompt line as the title and keeps it across a reload, and after an app restart the same five sessions and their lines are shown, and "Move to zone" changes a row's zone and keeps it after restart.

### Slice 4. Parent declarations: escalate and progress

**Outcome.** A parent can mark a child that is waiting as needing the human with a one-line reason (escalating a child that is not waiting is rejected with a non-zero exit), and declare how many slices a run has and how many are done. Needs you rows show the reason (falling back to "Needs permission" or "Has a question"); a run parent's card shows a progress bar such as "Slice 4 of 8, 8 children done". If the child's prompt has already notified, the escalation adds its reason to the row and does not pop up a second time; otherwise the popup body carries the reason. An escalation clears when the child leaves its waiting state or takes a new prompt; a later prompt from that child is a new event and notifies on its own. Both are live only: after an app restart they are gone, and a child still waiting reappears after the grace window with the fallback text.
**Files.** `src/cli/args.ts` and `src/cli/index.ts` (`grove escalate <ref> <reason>`, `grove progress <ref> <done>/<total>`), `src/shared/cli.ts`, `src/main/cliServer.ts`, `src/core/core.ts` (live, never persisted `attention?: {reason}` and `progress?: {done,total}` on `Session`), `src/shared/types.ts`, `src/shared/zones.ts` (an attention reason puts a waiting session in needs-you; `countsAsWaiting` is status-based and already counts it), `src/renderer/src/components/ZoneSection.tsx` (reason line), `src/renderer/src/components/Sidebar.tsx` (progress bar on a parent card), tests beside each.
**Verification.** `npm test` and `npm run typecheck` pass, with CLI tests for both commands (bad ref and bad argument exit non-zero) and a `zones` test that an escalated child lands in needs-you; a test that an escalation clears when the child's waiting state ends; a progress test for both the declared total and the fallback (children done out of children seen). Observable: `grove escalate <child> "asks to drop the table"` on a waiting child puts it in Needs you with that text (one popup in total for that prompt) and on a working child exits non-zero; `grove progress <parent> 4/8` shows the bar.

### Slice 5. Grace window and the handled record

**Outcome.** A child's permission or question is held for the grace window (default 60 s, `config.json` `escalateAfterSec`). If it clears in that time after a `grove send` whose caller is that child's parent session, it counts as handled: no popup, no count, and it appears in the parent's Running (handled) count. The parent card shows a badge with its handled count; opening it shows, for each handled prompt, when it happened, its kind, the last 8 lines of the child's screen as the prompt opened, and the exact text the parent sent back. If it clears with no CLI `send` (the human answered it directly, or the child dropped it), it is silent and counted nowhere, so the audit never claims a parent resolved something it did not. A send from another terminal or another session is not counted as the parent. That the parent chose a sensible answer is not checked; the audit shows it for the human to judge. If it does not clear, it moves to Needs you with a popup, as in D1.
A held prompt is marked on the session (`Session.held?`, live) so every consumer sees it; while held, a child's status dot and its parent's collapsed `mostUrgent` dot show working, not waiting.
**Files.** `src/core/core.ts` (`notifyTransitions`, a per-child timer, the live `held` flag and the `handled` list), `src/shared/zones.ts` (a held prompt is not needs-you), `src/renderer/src/sessionStatus.ts` (`countsAsWaiting` excludes held; cmd+. follows it), `src/cli/index.ts` and `src/shared/cli.ts` (`grove send` passes the caller's `GROVE_SESSION_ID`), `src/shared/types.ts` (`ConfigFile.escalateAfterSec?`), `src/core/store/configStore.ts` and the config rewrite at `core.ts:241-247` so the new field is kept (slice 7 does the same for `classifier`), `src/renderer/src/components/ZoneSection.tsx` (handled count and a popover listing kind and time), `src/main/cliServer.ts` (note a `send` and its text for a session that has a pending prompt), the tmux screen capture used by `grove read` (taken when a held prompt opens), `src/core/sessions.test.ts`.
**Verification.** `npm test` and `npm run typecheck` pass, with fake-timer tests: a child prompt answered by a CLI `send` within the window raises no `notify` and adds one handled entry holding the screen tail and the sent text; the same prompt cleared with no `send` adds none; one left unanswered raises exactly one `notify` after the window and from then on counts in "N waiting" and is visited by cmd+.; while held it does neither; a `send` from a session that is not the parent adds no handled entry; `grove escalate` still moves it at once. Observable: with a child sitting on a permission prompt, it shows in Needs you with a popup only after the window passes.

### Slice 6. Parents answer routine prompts

**Outcome.** The `grove-run` parent, when a child's wait returns "needs you" (exit 4), reads the child's screen, answers it if it is on the written routine list, and otherwise runs `grove escalate` with a one-line reason. The routine list and the unsure-means-escalate rule are written into the skills.
The parent re-reads the screen immediately before it sends an answer and escalates if the prompt changed; it answers with `grove send`.
**Files.** `resources/skills/grove/SKILL.md` (the in-repo skill text: routine list, the never-auto-answer list from D2, the wait-read-decide-send loop, `escalate`, `progress`), and the `grove-run` skill, which lives at `~/.claude/skills/grove-run` outside this repo: its text is first copied into `resources/skills/` so the change is reviewed and versioned in the repo (see Risks), `src/core/cliOps.test.ts` for the scripted transcript below.
**Verification.** The scripted check needs no installation. The real run below needs the copied `grove-run` text installed by the human first. A scripted check: a fake child that raises a routine prompt and then a destructive one, driven through `grove wait`, `grove read`, `grove send` and `grove escalate`, asserts exit code 4 is returned at once even with the grace window on, the routine prompt is answered and recorded as handled, and the destructive one ends in an escalation with a reason. Then a real run in a scratch repo with a two-slice plan whose first child hits a routine permission (run the project's test command) and whose second hits a destructive one (delete a directory): the first is answered by the parent and shows in the handled count with no popup; the second appears in Needs you with the parent's reason and a popup. Also `npm test` still passes.

### Slice 7. Small model: ambiguous sessions and one-line summaries

**Outcome.** When an agent session finishes and looks like it stopped on a question, a small fast model judges it; "needs you" moves it to Needs you with a one-line reason. The same call gives the one-line summary shown in Where you were and on rows. When the model is unsure, or is not available, the session goes to Needs you or keeps its label respectively.
**Files.** `src/core/classifier.ts` (new: build the prompt from the screen tail, run `claude -p --model <alias>` through an injectable runner, parse `needs-you | done` and a summary), `src/core/core.ts` (call on finished-unseen top-level agent sessions, store the verdict summary in `Session.lastLine` so it survives a restart, asynchronously with one call in flight, a 20 s cap and a cache by session and idle time, so it never blocks the core loop), `src/shared/types.ts` (`ConfigFile.classifier?: {enabled, model}`), `src/core/store/configStore.ts` and the config rewrite at `core.ts:241-247` (keep `classifier`), `src/shared/zones.ts` (classifier verdict feeds the zone), `src/renderer/src/components/ZoneSection.tsx` (summary line), `src/core/classifier.test.ts`. The model's summary replaces the last-prompt line for the sessions it runs on; other rows keep the last-prompt line from slice 3.
**Verification.** `npm test` and `npm run typecheck` pass; `classifier.test.ts` uses a fake runner for: question verdict -> needs-you, done verdict -> review, garbled or empty output -> needs-you, missing binary -> feature off with no error shown, and a runner that exceeds the cap is abandoned without blocking. Observable: a Claude session ended on "which of these two do you want?" appears in Needs you with a summary line; with `classifier.enabled: false` or no `claude` on the path, nothing is sent, no error is shown, and rows keep their last-prompt line.

## Reviewer round log

Round 1 (5 blocking, 12 non-blocking). Blocking: silent one-way choices in slices (CLI names, override semantics, config keys, screen data sent to a model) -> fixed by new D4 and D5, a Data paragraph in D3 and the config keys named in D1 and D3; grace window narrows "child prompt stays counted" -> fixed by a Held child prompts deviation and the scope paragraph in D1; "cleared in the window" falsely read as handled -> fixed in slice 5 by counting it only after a CLI `send`; escalation and progress lifetime unstated -> fixed in slice 4 and Risks; Where you were summaries not for every row -> fixed by a deviation. Non-blocking applied: shared `countsAsWaiting` helper and the :84 check, terminal children, `zone` stripped before save, never-focused and duplicate rows, other sidebar consumers, scripted slice 6 transcript, `wait` unaffected by the grace window, never-auto-answer list, re-read before send, skill copied into the repo first, async capped classifier, `declare a zone` deviation.

Round 2 (3 blocking, 12 non-blocking). Blocking: zone rule would show a held child prompt in Needs you -> fixed by stating child prompts stay needs-you until slice 5 and that slice 5 excludes held; held state did not reach the renderer -> fixed by a live `Session.held` and an updated `countsAsWaiting`; "handled" could be claimed for any sender -> fixed by passing the caller's session id and counting only the parent. Non-blocking applied: `zone` in `grove ls` is additive (D4), config rewrite for slice 7, Running shows working children only, finished-run verification, restart verification, skill fallback as a deviation, secrets note and children never classified, re-prompt notifies again, after-window count check.

CTO check (4 blocking). Where you were lines missing for most rows and after restart -> fixed by a last-prompt line kept on the session (slice 3) upgraded by the model (slice 7); readable names not delivered -> fixed by a derived display title in slice 3; held child prompts against "stays counted" -> kept, disclosed, and put to the human as an explicit question in the review; handled audit too thin -> fixed by keeping the screen tail and the parent's reply (slice 5).

Round 3 (4 blocking, 11 non-blocking). Blocking: finished and working children had no place in the zones view -> fixed in slice 3 (collapsed children line under the parent card); `grove escalate` could double-notify or reason text miss the popup -> fixed in slice 4 (no second popup, reason in the first); escalated session might not count in "N waiting" -> stated in slice 4 (escalate applies only to waiting sessions, which already count) and slice 7; escalate on a non-waiting child undefined -> rejected in slice 4. Non-blocking applied: slice 2 no longer depends on a later slice, top-level working sessions go to Running, the tree sort file is named, `sidebarView` and `lastLine` need no migration, handled count defined, held dots show working, prompt-injection and stored-prompt risks, settings tension, `zone` values in D4, slice 6 precondition, classifier off behaviour. No further round: the cap is 3.

Human review: held-prompt deviation accepted; veto pages 1 and 2: none.

## Deviations from the brief the human should know

- **New settings.** The brief says quiet should come from routing, not alert settings; `escalateAfterSec` and `classifier.*` are new `config.json` keys (hand-edited, no settings UI), kept because the hold and the model need a switch.
- **Held child prompts.** The brief says a child's permission or question stays counted. With the grace window (D1) it is held, uncounted and silent, for up to 60 s (`escalateAfterSec`, 0 turns it off) so the parent can answer it; after that it counts and notifies. Slice 1 alone still counts child prompts at once; the hold arrives in slice 5.
- **Where you were lines.** Every row gets a line: the last prompt's first line where Grove can read it, upgraded to a model summary for finished top-level Claude sessions (slice 7). A session whose prompt Grove cannot read (to be confirmed per agent kind in slice 3) shows its label and status text instead.
- **Parent behaviour depends on the skill.** If the `grove-run` text cannot be brought into this repo and installed, slice 6 delivers only the in-repo `grove` skill and the parent does not answer routine prompts; every prompt then reaches Needs you after the grace window.
- **Declaring a zone.** An agent can declare Needs you (`grove escalate`) and Ready to review (the existing `grove status <ref> in-review`); no other zone is declared by agents.
- **Audit detail.** The handled record holds the child's screen tail and the parent's reply, in memory only: it is gone after an app restart.
- **Readable names.** Titles are derived for display from the last prompt; stored labels are never rewritten.
- **Progress total.** "Slice 4 of 8" needs the parent to declare the total with `grove progress`; without it the bar shows children done out of children seen.
- **Failures.** As decided, there is no failed state. A child that crashes looks like a clean finish and stays quiet; the parent sees it through its own wait and halts the run with its own reason, as `grove-run` does today.
- **Tree order.** The project tree defaults to newest first.
- **Terminals.** Zones apply to terminal sessions from their existing status only (a finished long command is Ready to review); the small model covers agent sessions.
- **Superorchestrator.** Not built. Slices 4 and 6 give any parent session the ability to escalate, which is the base a later top-level orchestrator would use.

## Risks and what is deliberately not done

- **Out-of-repo skill.** `grove-run` is not bundled in this repo, so slice 6 first copies its text into `resources/skills/` and the human installs it from there; if that is not acceptable, slice 6 stops after the in-repo `grove` skill and the parent-side behaviour is not delivered.
- **Prompt injection.** The parent reads a child's screen, which can hold untrusted text, and decides whether to approve. The never-auto-answer list and the escalate-when-unsure rule are enforced by the model reading them, not by code, so a crafted prompt could talk a parent into a wrong approval; the handled audit is the only check.
- **Stored prompt text.** `Session.lastLine` writes the first line of a prompt to the state file; it is cut at 120 characters but can still hold a secret.
- **Slice size.** Slice 3 carries the sidebar, the title rule and the prompt line for three agent kinds; it may be split during implementation.
- **Lost declarations.** `attention` and `progress` do not survive a restart (slice 4).
- **Wrong approvals.** A parent can misjudge a prompt under D2 A. The handled record and the narrow routine list are the limits; widening the list later is a skill edit.
- **Grace-window delay.** A real blocker the parent neither answers nor escalates waits up to the window before it notifies.
- **Classifier cost and reach.** One headless call per finished top-level agent session, Claude only at first; OpenCode and Copilot sessions get the rule-based zones but not the model verdict until a runner exists for them.
- **Not done on purpose:** a failed state, inline answering, per-session mute, a presence check, per-project autonomy levels and replacing the project tree (the brief's non-goals).

## Open questions
