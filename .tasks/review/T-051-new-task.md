---
id: T-051
title: review implementation
status: review
created: '2026-04-05T13:48:51.661Z'
planTmuxSession: grove-plan-c0e897-T-051
planSessionId: ses_2a2167107ffexfjzqKHoEl8GDg
planSessionAgent: opencode
planModel: github-copilot/gpt-5-mini
execTmuxSession: grove-exec-c0e897-T-051
execSessionId: ses_2a20f1ff3ffeLJqRZ4i925epak
execSessionAgent: opencode
execModel: opencode/big-pickle
completed: '2026-04-05T14:05:02.275Z'
---

## Description

Two improvements to the task execution flow:

1. **Senior dev review step in execution prompt** — after the execution agent checks off all DoD items, the prompt instructs it to spawn a senior software engineer subagent to review the actual code changes (via git diff or equivalent), verify each DoD item was genuinely implemented, check for edge cases and code quality, and address any issues found before stopping. Up to 2 review cycles are permitted to avoid infinite loops.

2. **"ship it 🚢" indicator on task cards** — when a "doing" task's execution agent has stopped (waiting state) and all DoD checkboxes are ticked (`dodDone === dodTotal > 0`), the card shows "ship it 🚢" instead of "waiting for you". If DoD is incomplete or there are no DoD items, "waiting for you" continues to show as today. Only applies to doing-status cards.

## Definition of Done

- [x] `buildFirstExecutionMessage` in `src/renderer/src/utils/planPrompts.ts` contains explicit instructions: after all DoD checkboxes are checked off, spawn a senior software engineer subagent to review the changes, verify each item was genuinely implemented, check edge cases and code quality, address any issues, with a maximum of 2 review cycles
- [x] In `TaskCard.tsx`, derive `isDodComplete = task.dodTotal > 0 && task.dodDone >= task.dodTotal` (defensive: `>=` handles any malformed count edge case)
- [x] When `task.status === "doing"` and `isExecuteWaiting === true`: show "ship it 🚢" if `isDodComplete`, otherwise show "waiting for you" — backlog tasks are unaffected
- [x] New CSS styles for the "ship it" row and label added to `TaskCard.module.css` (visually distinct from "waiting for you", e.g. green/success color)
- [x] Manual verification: doing task with all DoD ticked + agent stopped → shows "ship it 🚢"
- [x] Manual verification: doing task with incomplete DoD + agent stopped → still shows "waiting for you"
- [x] Manual verification: backlog task with all DoD ticked + plan agent stopped → still shows "waiting for you" (unchanged)

## Context for agent
