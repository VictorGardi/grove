---
id: T-019
title: fix writing to task file while watcher is active
status: backlog
created: '2026-04-04'
useWorktree: false
planSessionId: ses_2a61c35ecffeJ45ECtcnG4CkXV
planSessionAgent: opencode
planModel: github-copilot/claude-opus-4.6
---

## Description

When a planning/execution agent (running in a git worktree) tries to modify the task file (e.g., checking DoD checkboxes), the changes are consistently lost or overwritten. Observed with multiple agents (Claude Sonnet/Opus, Big Pickle).

### Root Cause Analysis

There are **two** contributing failure modes in the worktree sync watcher (`src/main/ipc/git.ts:70-128`):

**Failure Mode 1: Atomic rename writes not detected**

The watcher uses `chokidar.watch(worktreeTaskFilePath)` — watching a single file path, listening only for `change` events (line 89). Most AI coding agents write files atomically via the standard temp-file + rename pattern (`writeFile(tmp) → rename(tmp, target)`). On macOS (FSEvents/kqueue), a rename-to may fire as `unlink` + `add` rather than `change`. Since the watcher only handles `change`, these writes are silently missed — or worse, the `change` event fires on the intermediate state.

**Failure Mode 2: Stale/partial content read**

The `awaitWriteFinish` configuration (`stabilityThreshold: 150ms`, `pollInterval: 50ms`) monitors file stat (size + mtime) stability. For agents that write via truncate-then-write (the default `fs.writeFile` with `w` flag), the watcher may fire during the truncated state if the timing is unlucky. The 300ms debounce (line 111) helps but does not fully protect against this since it reads at a fixed delay after the last event rather than verifying content integrity.

**Issue flow (current):**
1. Agent writes worktree task file (via temp+rename or truncate+write)
2. Watcher either (a) misses the event entirely (rename case) or (b) fires on partial/stale state
3. If the event fires, the watcher reads the file — may get truncated or pre-write content
4. Stale/empty content is written to root via `atomicWrite()`
5. Root now has old/corrupt version; worktree has correct version

### Implementation Plan

All changes are in `src/main/ipc/git.ts`, function `startWorktreeTaskWatcher()` (lines 70-128).

**Change 1: Watch the parent directory instead of the file** (primary fix)

Replace `chokidar.watch(worktreeTaskFilePath)` with a directory watch on `path.dirname(worktreeTaskFilePath)`, filtering events to the target filename. Handle both `change` and `add` events (`add` covers the rename-to case). This ensures atomic temp+rename writes by agents are reliably detected regardless of how the OS reports them.

```
// Before:
chokidar.watch(worktreeTaskFilePath, { ... })
watcher.on("change", () => { ... })

// After:
chokidar.watch(path.dirname(worktreeTaskFilePath), { ... })
watcher.on("all", (event, changedPath) => {
  if (path.basename(changedPath) !== taskFilename) return;
  if (event !== "change" && event !== "add") return;
  // ... existing debounce and sync logic
})
```

**Change 2: Add content validation before writing to root** (defense-in-depth)

Before calling `atomicWrite(rootPath, content)`, validate the content read from the worktree:
- Non-empty (skip if empty or whitespace-only)
- Contains YAML frontmatter markers (starts with `---`)

This prevents corrupt/truncated content from ever reaching the root, even if timing is wrong.

**Change 3: Track last-synced content to prevent redundant/stale writes**

Store the content string of the last successful sync per watcher key. Before writing to root, compare the newly read content against the last-synced value. Skip if identical. This eliminates redundant writes and provides an additional layer of protection against stale reads.

On watcher re-establishment after app restart (`reestablishWorktreeTaskWatchers` in `src/main/ipc/workspace.ts`), the last-synced value starts as `undefined` — the first change event will always sync, which is correct behavior.

**Change 4: Moderate increase to `stabilityThreshold`**

Increase `awaitWriteFinish.stabilityThreshold` from 150ms to 300ms. Minor buffer — not the primary fix, but gives more time for writes to complete without introducing noticeable UX delay. Set `pollInterval` to 100ms. Debounce timer stays at 300ms. Total worst-case latency: ~600ms from last write activity.

**Change 5: Add diagnostic logging**

Log sync events with enough detail to debug future issues: event type, content length, sync decision (skipped/written), and reason for skip. Use `console.log` with `[WorktreeTaskWatcher]` prefix consistent with existing log lines.

### Files Modified

- `src/main/ipc/git.ts` — `startWorktreeTaskWatcher()` function (lines 70-128): all changes above

### What This Does NOT Change

- One-way sync architecture (worktree → root) is preserved
- `atomicWrite` for root writes is unchanged
- Root task watcher in `watchers.ts` is unchanged
- Worktree setup/teardown flow is unchanged
- Write lock system in `tasks.ts` is unchanged
- Debounce timing remains at 300ms

## Definition of Done

- [ ] Worktree sync watcher watches the parent directory (not the file) and handles both `change` and `add` events, filtered to the target task filename
- [ ] Content validation: sync skips writes when worktree content is empty or missing frontmatter markers (`---`)
- [ ] Last-synced content tracking: sync skips writes when content is identical to the last successfully synced content
- [ ] `awaitWriteFinish.stabilityThreshold` increased from 150ms to 300ms on the worktree sync watcher
- [ ] Diagnostic logging added to worktree sync watcher (event type, content length, sync decision)
- [ ] One-way sync architecture preserved (worktree → root only, no changes to root watcher or other sync paths)
- [ ] Verified: agent edits to DoD checkboxes (via temp+rename write pattern) persist in both worktree and root after sync
- [ ] Verified: agent edits to DoD checkboxes (via in-place write pattern) persist in both worktree and root after sync
- [ ] Verified: rapid successive agent edits are coalesced and final state is correctly synced
- [ ] Verified: empty/truncated content is never written to root task file
- [ ] Verified: no regression — root task watcher still picks up UI-initiated changes
- [ ] Verified: watcher re-establishment on app restart works correctly (watchers resume syncing)

## Context for agent
