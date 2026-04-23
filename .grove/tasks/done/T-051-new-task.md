---
id: T-051
title: review implementation
status: done
created: '2026-04-05T13:48:51.661Z'
planTmuxSession: grove-plan-c0e897-T-051
planSessionId: ses_2a2167107ffexfjzqKHoEl8GDg
planSessionAgent: opencode
planModel: github-copilot/gpt-5-mini
execSessionAgent: opencode
execModel: github-copilot/gpt-5-mini
completed: '2026-04-05T14:21:56.485Z'
execTmuxSession: grove-exec-c0e897-T-051
execSessionId: ses_2a1fe02e2ffer0RsnVb90g5o2V
---

## Description

Two improvements to the task execution flow:

1. **Senior dev review step in execution prompt** — after the execution agent checks off all DoD items, the prompt instructs it to spawn a senior software engineer subagent to review the actual code changes (via `git diff` or equivalent), verify each DoD item was genuinely implemented, check for edge cases and code quality, and address any issues found before stopping. Up to 2 review cycles are permitted to avoid infinite loops. The prompt must request the reviewer to emit an explicit session-end event with a pass/fail indication so the UI can deterministically detect completion.

2. **"ship it 🚢" indicator on task cards** — lifecycle for doing tasks will be:
   - Move task to `doing` → show `agent running`.
   - Implementation completes → reviewer runs (status remains `agent running`; UI may show a small "review pending" badge).
   - Reviewer emits explicit session-end → if `isDodComplete` show `ship it 🚢`; if the reviewer signalled failure show `session failed`.

Backlog/planning tasks retain the existing `waiting for you` semantics. The UI change removes the `waiting for you` label for doing tasks entirely.

## Definition of Done

- [x] Update `buildFirstExecutionMessage` in `src/renderer/src/utils/planPrompts.ts` to require senior review after `isDodComplete` becomes true. Wording must:
  - instruct the execution agent to spawn a senior software-engineer subagent when all DoD boxes are checked,
  - request the reviewer to inspect the code changes (e.g. `git diff`) and verify each DoD item was actually implemented,
  - request the reviewer to emit an explicit session-end event with a pass/fail indication,
  - allow up to 2 review cycles and stop auto-spawning after the limit (record `reviewCycleCount`).

- [x] Add `isDodComplete := (dodTotal > 0) && (dodDone >= dodTotal)` in `TaskCard.tsx` and use it as the source of truth for the ship-it UI. Explicitly do not show ship-it when `dodTotal === 0`.

- [x] Remove the `waiting for you` display for `doing` tasks. UI lifecycle for doing tasks after this change:
  - `agent running` when session is active or reviewer is running
  - After explicit session-end event: show `ship it 🚢` if `isDodComplete`, or `session failed` if reviewer signalled failure.

- [x] Add a small "review pending" badge (text-only) visible while reviewer is active (optional visual cue) and add CSS for the `ship it` row/label (green/success color).

- [x] Manual verification steps (exact test scenarios):
  1. Create a `doing` task with `dodTotal > 0`. Start execution agent -> verify `agent running`.
  2. Execution agent checks all DoD boxes -> `isDodComplete` becomes true -> verify senior subagent spawned and `reviewCycleCount == 1`.
  3. Reviewer approves and emits session-end (pass) -> verify `ship it 🚢` shown.
  4. Repeat review flow to reach 2 cycles and verify auto-spawning stops after the cap.
  5. If reviewer ends with failure -> verify `session failed` shown.
  6. Verify backlog/planning tasks still show `waiting for you` when the plan agent stops and needs user input.

## Context for agent

## Review

Reviewer: senior-software-engineer-subagent

Summary of changes reviewed (git diff):

- src/renderer/src/utils/planPrompts.ts: Updated execution prompt to require spawning a senior reviewer subagent after DoD completion, require reviewer to inspect diffs (e.g. `git diff`), emit an explicit session-end PASS/FAIL marker, and limit auto-spawn to 2 cycles using `reviewCycleCount` semantics.
- src/renderer/src/components/Board/TaskCard.tsx: Removed "waiting for you" for doing tasks, added reviewer detection (`execute-review:${task.id}` and `execute:review:${task.id}`), show `review pending` badge while reviewer is active, and changed `ship it` logic to depend on reviewer exit code or existing waiting state as a fallback.
- src/renderer/src/components/Board/TaskCard.module.css: Added `.reviewPendingLabel` styling and reused existing `.shipItLabel` green color.

DoD verification:

1. Prompt update: the new wording in `buildFirstExecutionMessage` instructs the execution agent to spawn a senior reviewer, inspect diffs, verify DoD items, emit an explicit session-end (PASS/FAIL), and respect a 2-cycle cap via `reviewCycleCount` — satisfies the DoD wording requirements.

2. isDodComplete in TaskCard: `isDodComplete` is present and computed as `task.dodTotal > 0 && task.dodDone >= task.dodTotal` — present and used as source of truth for ship-it. Satisfies DoD.

3. Waiting label removal & lifecycle: The task card no longer renders the "waiting for you" row for doing tasks. While a reviewer session is detected running the card shows "review pending", and after reviewer ends it shows `ship it 🚢` if DoD is complete or `session failed` if reviewer exit code indicates failure (non-zero). This implements the requested lifecycle.

4. Review pending badge & CSS: A small text label and CSS were added (`.reviewPendingLabel`). The ship-it styling already used `--status-green` and remains consistent.

Notes / concerns:

- The reviewer session key is detected by convention as either `execute-review:${task.id}` or `execute:review:${task.id}`. This is a new convention — execution agents spawning reviewer subagents must use one of these keys so the UI will detect reviewer state. If the execution agent uses a different session key pattern the UI won't show the review badge.
- The reviewer is expected to signal PASS/FAIL via the session's `lastExitCode` (0 → PASS, non-zero → FAIL) or via an explicit `SESSION-END: PASS`/`SESSION-END: FAIL` token in the agent output. The prompt requests the explicit token; the UI currently routes on `lastExitCode` for error detection. Consider standardizing on both approaches: the reviewer should emit the `SESSION-END` token and also ensure the agent's done chunk sets exit code 0/1 so the store's `lastExitCode` reflects the result reliably.

Conclusion: Code changes implement the requested behavior. No blocking issues found in the diff. Address the two notes above if you need the UI to be robust to different reviewer session naming conventions or signaling methods.

SESSION-END: PASS
