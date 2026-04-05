---
id: T-016
title: bug in worktree where task file in root is untouched
status: review
created: '2026-04-04'
worktree: .worktrees/T-016
branch: feat/t-016-bug-in-worktree-where-task-fil
planSessionId: ses_2a6cb645dffek1ZlfXNwd16muG
planSessionAgent: opencode
planModel: github-copilot/claude-opus-4.6
useWorktree: false
execSessionId: ses_2a68593ceffek8h5a8C9gXrzvV
execSessionAgent: opencode
---

## Description

### Problem

When a task is moved to "Doing", a git worktree is created at `.worktrees/<taskId>`. The task `.md` file is **copied** from `<root>/.tasks/doing/<file>.md` into the worktree at `.worktrees/<taskId>/.tasks/doing/<file>.md` (`src/main/ipc/git.ts:132-154`). After this one-shot copy, the two files diverge independently.

The UI only reads and watches the **root repo's** `.tasks/` directory (`src/main/watchers.ts:17-24`). The `.worktrees/` directory is explicitly excluded from watchers. When an AI coding agent running in the worktree updates DoD checkboxes or adds notes to the worktree's copy of the task file, those changes are invisible in the UI.

### Root Cause

There is no sync mechanism from worktree task file back to the root repo task file. The copy is one-shot and one-way (root → worktree) at worktree creation time.

### Rejected Alternative: Symlink

Replacing `copyFile` with `symlink` was considered but rejected because **atomic writes** (write `.tmp` + `fs.rename`) — used by many editors and agents — **replace the symlink with a regular file**, silently breaking the link and reverting to the original bug. Specifically, `fs.rename('path.tmp', 'path')` where `path` is a symlink replaces the symlink itself (not the target), destroying the link. This failure mode is silent and hard to debug.

### Solution: Worktree Task File Watcher (One-Way Reverse Sync)

Keep the existing `copyFile` behavior. Add a chokidar watcher on the worktree's task file that syncs changes back to the root repo's copy whenever the agent modifies it.

**How it works:**
1. After `copyFile` in `setupWorktreeForTask`, start a chokidar watcher on the worktree's copy
2. On `change` event (debounced), read the worktree file and dynamically resolve the root task file's current path (it may have moved due to status transitions), then use `atomicWrite` to write it there
3. The existing root `.tasks/` watcher fires → `workspace:dataChanged` → UI refreshes automatically
4. On `teardownWorktreeForTask`, close the watcher and clean up
5. On app restart, re-establish watchers for any active worktrees

**Architectural constraint — strictly one-way sync:** Sync is exclusively worktree → root. The initial `copyFile` at worktree creation is the only root → worktree transfer. No code path ever writes from root back to the worktree copy after setup. The root task watcher (`watchers.ts:26-30`) only emits `workspace:dataChanged` IPC to the renderer — it never triggers file writes. The renderer's `dataChanged` handler re-reads tasks from disk and updates React state — it does not write files. This makes feedback loops architecturally impossible.

### Implementation Details

**Files to modify:**

1. **`src/main/ipc/git.ts`** — Module level
   - Add `const worktreeTaskWatchers = new Map<string, chokidar.FSWatcher>()` (key: `${workspacePath}:${taskId}`)
   - Add helper `function resolveRootTaskPath(workspacePath: string, filename: string): Promise<string | null>` that scans all 5 status directories (`doing`, `review`, `done`, `backlog`, `archive`) for the file and returns the first match, or `null` if not found
   - Add `export function closeAllWorktreeTaskWatchers()` for cleanup
   - Add `export function startWorktreeTaskWatcher(workspacePath: string, taskId: string, worktreeTaskFilePath: string, taskFilename: string)` — extracted helper so both setup and workspace-activation can call it

2. **`src/main/ipc/git.ts`** — `git:setupWorktreeForTask` handler (after the copyFile block, ~line 154)
   - After copying the task file, call `startWorktreeTaskWatcher(workspacePath, taskId, worktreeTaskCopyPath, basename)`
   - The helper:
     - Creates a chokidar watcher on the worktree copy path
     - Configures with `ignoreInitial: true`, `ignored: /\.tmp$/`, `awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }`
     - On `change` event: debounce 300ms, then in a try/catch:
       1. Read the worktree file content via `fs.promises.readFile`
       2. Call `resolveRootTaskPath(workspacePath, filename)` to find current root location
       3. If found, call `atomicWrite(resolvedPath, content)` to sync back
       4. If not found, log warning (task may have been archived or deleted)
     - On `unlink` event: log warning, no-op
     - On `error` event: log error (prevents unhandled EventEmitter crash)
     - Stores the watcher in the Map keyed by `${workspacePath}:${taskId}`

3. **`src/main/ipc/git.ts`** — `git:teardownWorktreeForTask` handler (~line 207)
   - Before removing the worktree, derive `taskId` from `path.basename(worktreePath)` (reliable — worktree path convention is `.worktrees/<taskId>`, hardcoded in `createWorktree`)
   - Look up watcher by `${workspacePath}:${taskId}`, close it, and remove from the Map

4. **`src/main/index.ts`** — `before-quit` handler (~line 98)
   - Import and call `closeAllWorktreeTaskWatchers()` alongside existing `stopWatchers()`

5. **`src/main/ipc/workspace.ts`** — Workspace activation
   - In both `workspace:setActive` and `workspace:getActive`, after calling `startWatchers()`, scan for active worktrees and re-establish sync watchers:
     1. Iterate over `["doing", "review", "done", "backlog", "archive"]` directories in `.tasks/`
     2. For each `.md` file, use `parseTaskFile()` to read frontmatter
     3. If `worktree` field is set and the worktree directory exists on disk, and no watcher exists for this `${workspacePath}:${taskId}` key, call `startWorktreeTaskWatcher()`
     4. The worktree task file path is `path.join(workspacePath, worktree, ".tasks", "doing", filename)` (the worktree copy always stays in `.tasks/doing/`)

### Edge Cases

- **Write loops**: Architecturally impossible. Sync is strictly one-way (worktree → root). The root task watcher only sends IPC events to the renderer. The renderer only reads — never writes — on `dataChanged`. No future code should add root → worktree sync without adding a suppression guard.
- **Concurrent / rapid writes**: Debounced at 300ms in the sync callback so rapid agent edits (e.g., checking multiple DoD boxes) coalesce into a single root write. `atomicWrite` (write `.tmp` + rename) prevents partial reads. The existing `.tmp` ignore rule on both the root task watcher (`watchers.ts:21`) and the new worktree watcher prevents spurious events.
- **Multiple worktrees / workspaces**: Each watcher is keyed by compound `${workspacePath}:${taskId}`. Independent and isolated. No collision across workspaces.
- **Root task file path invalidation (status transition)**: The sync callback does NOT cache the root path from setup time. On every sync event, it dynamically resolves the current location by scanning all 5 status directories (`doing`, `review`, `done`, `backlog`, `archive`) for the matching filename. This handles the case where the user moves the task (e.g., doing → review) while the agent is still running.
- **App restart with active worktrees**: Watchers are in-memory only. On restart, workspace activation scans tasks with `worktree` frontmatter set and re-establishes watchers.
- **Worktree task file deleted by agent**: `unlink` event logged as warning, no-op. No crash.
- **Worktree copy stays in `.tasks/doing/`**: Even if the root task moves to `review`, the worktree copy remains at its original path. Only the sync target is resolved dynamically.
- **Sync error handling**: The sync callback wraps all operations in try/catch. If `atomicWrite` fails, the error is logged but the watcher continues. The chokidar `error` event is also handled to prevent unhandled EventEmitter crashes.
- **Worktree directory deleted externally**: Chokidar emits `unlink`, handled gracefully.

## Definition of Done

- [x] Add a `Map<string, chokidar.FSWatcher>` in `src/main/ipc/git.ts` keyed by `${workspacePath}:${taskId}`
- [x] Extract `startWorktreeTaskWatcher()` helper and `resolveRootTaskPath()` helper in `src/main/ipc/git.ts`
- [x] After `copyFile` in `setupWorktreeForTask`, call `startWorktreeTaskWatcher()` to begin watching the worktree task file
- [x] Watcher config: `ignoreInitial: true`, `ignored: /\.tmp$/`, `awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }`
- [x] On `change` event: debounce 300ms, read worktree file, resolve current root path via `resolveRootTaskPath()` (checks all 5 dirs: `doing`, `review`, `done`, `backlog`, `archive`), then `atomicWrite` to root
- [x] Wrap sync callback in try/catch with error logging; handle chokidar `error` and `unlink` events gracefully
- [x] In `teardownWorktreeForTask`: derive taskId via `path.basename(worktreePath)`, look up and close watcher, remove from Map
- [x] Add `closeAllWorktreeTaskWatchers()` export; call it in `before-quit` handler in `src/main/index.ts`
- [x] In `workspace:setActive` and `workspace:getActive` (`src/main/ipc/workspace.ts`): after `startWatchers()`, scan task files for active worktrees and call `startWorktreeTaskWatcher()` for each
- [x] Agent edits to DoD checkboxes in worktree task file are reflected in the UI (root watcher picks up `atomicWrite` and sends `workspace:dataChanged`)
- [x] No write loops: sync is strictly one-way (worktree → root), no code path writes root → worktree after initial setup
- [x] Worktree teardown cleanly closes watcher without errors

## Context for agent

Key files to modify:
- `src/main/ipc/git.ts` — Main changes: watcher Map, `startWorktreeTaskWatcher()`, `resolveRootTaskPath()`, `closeAllWorktreeTaskWatchers()`, watcher setup in `setupWorktreeForTask` (~line 154), cleanup in `teardownWorktreeForTask` (~line 207)
- `src/main/index.ts` — Add `closeAllWorktreeTaskWatchers()` call in `before-quit` handler (~line 98)
- `src/main/ipc/workspace.ts` — Re-establish watchers on workspace activation in `workspace:setActive` (~line 207) and `workspace:getActive` (~line 231)
- `src/main/fileWriter.ts` — Use existing `atomicWrite` for the reverse sync (do not use `fs.copyFile`)
- `src/main/watchers.ts` — Reference for chokidar configuration patterns (do not modify)
- `src/main/tasks.ts` — Use `parseTaskFile()` for reading task frontmatter when scanning for active worktrees

Key constraints:
- Use `atomicWrite` (not `fs.copyFile`) for writing to the root task file — ensures atomic operation and works with existing `.tmp` ignore rules
- Match existing `awaitWriteFinish` settings: `{ stabilityThreshold: 150, pollInterval: 50 }`
- New worktree watcher must also set `ignored: /\.tmp$/` to ignore intermediate `atomicWrite` temp files
- The watcher Map must use compound key `${workspacePath}:${taskId}` to avoid collision across multiple workspaces
- The sync is strictly one-way: worktree → root. Never write back to the worktree copy after initial setup.
- Always resolve root task path dynamically on each sync (never cache) — handles status transitions
- Debounce sync callback at 300ms to coalesce rapid agent writes
- Derive taskId in teardown via `path.basename(worktreePath)` (convention: `.worktrees/<taskId>`)
- Import `chokidar` (already a dependency) and `atomicWrite` from `../fileWriter`
