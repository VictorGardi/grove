---
id: T-024
title: Show "waiting for you" indicator on task cards when agent session is complete
status: done
created: "2026-04-04"
useWorktree: false
planSessionId: ses_2a60fa4c2ffekeoNhWvVbWRnHU
planSessionAgent: opencode
planModel: opencode/big-pickle
execSessionId: ses_2a607db4fffeltyrlBiAmvOePI
execSessionAgent: opencode
---

## Description

When an agent session in planning (backlog) or execution (doing) is complete, show a visual indicator that differs from the "agent running" indicator. This tells the user the agent has finished and is waiting for their input.

### Current behavior

- TaskCard shows "agent running" indicator when `isRunning` is true
- When `isRunning` becomes false, the indicator disappears entirely

### Expected behavior

- Show "waiting for you" indicator when:
  - Session exists for the task
  - Session has messages (`messages.length > 0`)
  - Session is NOT running (`isRunning === false`)
- For error/failed sessions (lastExitCode !== 0), show error state instead

## Definition of Done

- [x] Add `isWaitingForInput` derived selectors in TaskCard for both execute and plan sessions (check: session exists, has messages, not running, lastExitCode is null/0)
- [x] Display "waiting for you" indicator on task cards when session is complete but awaiting user input
- [x] Display error indicator when session has failed (lastExitCode !== 0)
- [x] Verify indicator shows correctly for both planning (backlog) and execution (doing) tasks
- [x] Verify indicator does NOT show for new sessions with no messages
- [x] Verify indicator does NOT show for sessions that were cleared

## Context for agent

### Files to modify

- `src/renderer/src/components/Board/TaskCard.tsx` - Add waiting/error indicator UI

### Key references

- `usePlanStore.ts`: Sessions store with `isRunning`, `messages`, and `lastExitCode`
- Sessions keyed by `execute:${taskId}` for doing tasks and `plan:${taskId}` for backlog tasks
- Existing agent running indicator at lines 58-70 in TaskCard.tsx
