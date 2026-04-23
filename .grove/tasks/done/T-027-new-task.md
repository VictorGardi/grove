---
id: T-027
title: takes too long to open new task?
status: done
created: "2026-04-05"
planSessionId: ses_2a3e46e56ffeo5QmNjXWFxGNHK
planSessionAgent: opencode
planModel: opencode/big-pickle
useWorktree: false
execSessionId: ses_2a3e09ad5ffeFw4ozznVqC3ZUs
execSessionAgent: opencode
execModel: opencode/big-pickle
---

## Description

Creating a new task feels slow because:

1. Main process writes file to disk
2. Chokidar detects change (150ms `awaitWriteFinish`)
3. Renderer receives `workspace:dataChanged`, debounces 200ms
4. Renderer re-scans ALL tasks via `scanTasks()`
5. Finally selects the task and fetches body

**Root cause:** Unlike `updateTask` and `moveTask` (which immediately patch the store), `createTask` only calls `setSelectedTask(result.data.id)`. Since the task isn't in the store yet (chokidar hasn't fired), `setSelectedTask` finds no matching task and skips fetching the body.

**Fix:** Call `patchTask(result.data)` before `setSelectedTask` so the task exists in the store immediately.

## Definition of Done

### Test 1: New task body is immediately available

- [x] Create a new task via UI
- [x] Immediately verify selected task body is populated (not loading, not empty)
- [x] Current behavior: body is empty until page refresh

### Test 2: No redundant fetch after chokidar

- [x] Create a new task
- [x] Verify no duplicate task appears in tasks list (no double-add)
- [x] Verify no "duplicate" log in console (search for task ID)

### Test 3: Edge case - create fails on disk

- [x] Mock IPC failure for createTask
- [x] Verify no task is patched to store
- [x] Verify selectedTaskId is NOT set

### Test 4: Edge case - rapid sequential creates

- [x] Create 5 tasks in rapid succession
- [x] Verify all 5 appear exactly once in tasks list

## Context for agent
