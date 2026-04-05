---
id: T-043
title: start task execution directly when moving task to doing
status: done
created: "2026-04-05"
planTmuxSession: grove-plan-c0e897-T-043
planSessionId: ses_2a2661617ffeulEj3xdkVeuLSd
planSessionAgent: opencode
planModel: opencode/big-pickle
execSessionAgent: opencode
execTmuxSession: grove-exec-c0e897-T-043
execSessionId: ses_2a23c0749ffeikXFRGnaEyvnTS
execModel: opencode/big-pickle
completed: "2026-04-05T13:47:58.018Z"
---

## Description

When a task is dragged into the "doing" column, execution starts automatically — no manual Send click and no task detail panel opening. The user picks the execution model via a compact `<select>` dropdown on the task card, visible in both `backlog` and `doing` columns so they can choose before dragging. The agent can also be set per-card in backlog/doing. On drag-to-doing the agent is resolved from `execSessionAgent ?? defaultExecutionAgent ?? "opencode"` and the model from `execModel ?? defaultExecutionModel ?? null`. The running indicator on the card is the primary feedback that execution is underway.

### Implementation notes

- **`buildFirstExecutionMessage`** must be extracted from `PlanChat.tsx` to `src/renderer/src/utils/planPrompts.ts` to avoid an inverted Board→PlanChat import dependency. Both files import from there.
- **`setSelectedTask(task.id)`** at `Board.tsx:312` is removed. The panel does not auto-open on drag.
- **`startAgentMessage("execute:{taskId}")`** on `usePlanStore` must be called from `handleDragToDoing` immediately after `plan.send` returns `{ ok: true }`. Without this call, the in-memory store has no agent message slot, incoming chunks from the agent are silently discarded, and `isRunning` stays `false` — the running indicator never appears.
- **Worktree path** from `setupWorktreeForTask` is relative; must be prepended with `workspacePath` before passing to `plan:send`.
- **Workspace defaults** are loaded lazily. `fetchDefaults` must be called (or awaited) in the drag path before reading `workspaceDefaults[workspacePath]`; if still undefined, fall back to `"opencode"` / `null`.
- **Model list cache**: do not call `listModels` per card. Fetch once per `(workspacePath, agent)` pair and cache in a shared store (e.g. extend `usePlanStore` with `modelsCache: Record<string, string[]>`). Cards read from the cache synchronously; the first card for a given pair fires the IPC fetch.
- **`plan:cancel`** must be called before clearing `execTmuxSession` on re-drag, to avoid orphaning a still-running background tmux session.

## Definition of Done

- [x] Dragging a task to "doing" automatically calls `plan:send` in execute mode. In worktree mode the call fires after `setupWorktreeForTask` returns `ok: true`, using the result's `worktreePath` resolved to absolute path. In root-repo mode (`useWorktree: false`) the call fires immediately after `moveTask` succeeds.
- [x] Immediately after `plan.send` returns `{ ok: true }`, `usePlanStore.getState().startAgentMessage("execute:{taskId}")` is called, creating the agent message slot and setting `isRunning: true`. This makes the running indicator on the card visible without the user opening the panel.
- [x] The task detail panel does NOT auto-open after drag-to-doing. The `setSelectedTask(task.id)` call at `Board.tsx:312` is removed. If a different task's panel was already open, it remains open unchanged.
- [x] Agent resolution: `task.execSessionAgent ?? defaultExecutionAgent ?? "opencode"`. Model resolution: `task.execModel ?? defaultExecutionModel ?? null`. Workspace defaults are fetched before reading them; `undefined` config falls back to the hardcoded values.
- [x] A compact agent `<select>` and model `<select>` are rendered on `TaskCard` in the Row 5 controls area for `task.status === "backlog"` and `task.status === "doing"`. They are not shown for `review` or `done`.
- [x] Agent dropdown options are derived from the `PlanAgent` type constant (`"opencode"`, `"copilot"`). Selecting a new agent calls `updateTask(task.filePath, { execSessionAgent: newAgent, execModel: null })`, clearing the model to avoid an invalid agent/model combination.
- [x] Model dropdown options are served from a shared in-memory cache keyed by `"${workspacePath}:${agent}"`. On first render of any card with a given pair, one `listModels` IPC call is fired and results stored in the cache; subsequent cards read synchronously. A loading placeholder is shown while the first fetch for that pair is in flight. If `listModels` returns an empty array or errors, the dropdown renders a single "default" option (representing `execModel: null`).
- [x] Selecting a model calls `updateTask(task.filePath, { execModel: newModel })`. If the selected model is not present in the model list for the resolved agent at drag time (stale selection), `model: null` is passed to `plan.send` instead.
- [x] Both the agent and model dropdowns are disabled when `usePlanStore` `isRunning === true` for `execute:{taskId}`, or when `useWorktreeStore.creatingIds` contains the task ID.
- [x] Auto-execution is skipped if `usePlanStore` for `execute:{taskId}` has `isRunning === true` at drag time. A completed or failed prior session does not block auto-execution.
- [x] When a task is re-dragged to doing after returning to backlog: if `execTmuxSession` is non-null, `plan:cancel` is called first to kill any orphaned background process; then `execSessionId`, `execTmuxSession`, and the in-memory plan store session for `execute:{taskId}` are cleared before auto-execution fires.
- [x] `buildFirstExecutionMessage` is extracted to `src/renderer/src/utils/planPrompts.ts` and imported by both `Board.tsx` and `PlanChat.tsx`. No other files are affected.
- [x] If `window.api.tasks.readRaw` fails, a toast is shown ("Could not read task file — execution not started") and auto-execution is aborted. The task move and worktree creation are not rolled back.
- [x] If `window.api.plan.send` returns `{ ok: false }`, a toast is shown with the error. Non-zero agent exit codes are surfaced via the existing error dot on the card (no additional toast).
- [x] Dragging a task from "doing" to "doing" remains a no-op (existing `task.status === toStatus` early-return guard in `handleDragEnd` is preserved).

## Context for agent
