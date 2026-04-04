---
id: T-012
title: Allow PlanChat agent to run in background when UI closed
status: done
created: '2026-04-04'
autoRun: true
agent: opencode
worktree: null
branch: null
---

## Description

Currently, when a user closes the PlanChat panel/ticket while an agent is running, the agent process is cancelled via IPC. This means if the user navigates away and comes back, the conversation is interrupted and they must restart.

Instead, we want the agent to continue running in the background (server-side) so when the user re-opens the task, they see the agent still working and can continue the conversation.

## Definition of Done

- [ ] Remove cancel-on-unmount logic from PlanChat.tsx useEffect
- [ ] Agent continues running after component unmounts
- [ ] When task is reopened, PlanChat re-mounts and shows existing session with messages
- [ ] `isRunning` state syncs correctly when re-opening (may need IPC to check server status)
- [ ] Streaming updates continue to be received and stored even when UI is closed
- [ ] Clean up any orphaned sessions on app quit (optional, can be manual)
- [ ] Test: Open task, start agent, close task, wait, reopen task - agent should still be running or completed
- [ ] Test: Agent completes while UI closed, messages should all be visible on reopen

## Technical notes

- The plan agent runs in the main process via `window.api.plan.send`
- Sessions are stored in `usePlanStore` (Zustand) keyed by taskId
- Currently line 176-181 in PlanChat.tsx calls `window.api.plan.cancel(task.id)` on unmount
- Need to remove this cancel call or make it conditional (e.g., only cancel if user explicitly stops)
- The streaming already uses IPC events that update the store - as long as store isn't cleared, messages persist
- May need to query current running state on mount via `window.api.plan.getStatus(taskId)` or similar

## Context for agent

Focus on preserving the agent process when the React component unmounts. The key files are:

- `src/renderer/src/components/TaskDetail/PlanChat.tsx` - remove cancel-on-unmount
- `src/renderer/src/stores/usePlanStore.ts` - verify session persists
- Main process handlers in `src/main/` for plan IPC - ensure they don't auto-kill on disconnect
