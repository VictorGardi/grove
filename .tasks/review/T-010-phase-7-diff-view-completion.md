---
id: T-010
title: 'Phase 7: Diff View Completion + Worktree/Branch Selector in Files View'
status: review
priority: high
agent: opencode
created: '2026-04-03'
tags:
  - phase-7
  - diff
  - worktree
---

## Description

Complete Phase 7 (Diff View) by closing the remaining gaps and adding a worktree/branch selector to the Files view. The core diff infrastructure (ChangesTab, git:diff, git:fileDiff, inline diff renderer, auto-refresh) is already implemented. This task addresses the remaining integration issues and the new feature request.

### Already Done (verified in code)

1. IPC handler `git:diff(worktreePath, baseBranch)` with merge-base
2. Changes tab in task detail panel (visible when status=doing + worktree set)
3. Summary header showing file count + line deltas
4. Changed files list with status pills (M/A/D/R), file paths, line deltas
5. IPC handler `git:fileDiff` returning raw unified diff string
6. Custom React diff parser and renderer with correct colors
7. Long diffs: first 150 lines then "Show N more lines"
8. Untracked/new files (status A) handled
9. Deleted files (status D) handled
10. Refresh button + auto-refresh on terminal idle (3s)
11. "View file" button that switches to Files view
12. Base branch auto-detection with main/master fallback
13. Info banner about diff scope

### Remaining Work

**Task 1: Worktree-aware fs:tree and fs:readFile (backend)**
Widen validation in `fs:tree` and `fs:readFile` to accept worktree paths (children of `<workspace>/.worktrees/`). Extract `isAllowedPath()` helper. No new IPC channels needed.

**Task 2: Worktree/Branch selector in Files view (frontend)**
Add `selectedRoot` state to `useFileStore`. Create `WorktreeSelector` dropdown component. Modify `fetchTree()`, `openFile()`, `reloadOpenFile()` to use `selectedRoot.path` when set. Show selector only when worktrees exist.

**Task 3: Fix "View file" to open in worktree context**
Set `selectedRoot` to the worktree path before switching to Files view, so the user sees the correct file version.

**Task 4: Per-workspace base branch config**
Read `baseBranch` from `<repo>/.grove/config.json` before falling back to auto-detection. Uses `git rev-parse --git-common-dir` to find the main repo from a worktree.

## Definition of Done

- [x] `fs:tree` and `fs:readFile` accept worktree paths that are children of a registered workspace's `.worktrees/` directory
- [x] `fs:tree` and `fs:readFile` still reject arbitrary paths not associated with any registered workspace
- [x] Files view shows a worktree/branch selector dropdown when the workspace has active worktrees
- [x] Selecting a worktree in the dropdown re-roots the file tree to that worktree's directory
- [x] Selecting "repo root" in the dropdown returns to the main workspace file tree
- [x] Selector is hidden when there are no active worktrees (only the main repo exists)
- [x] "View file" from ChangesTab switches to Files view with the worktree selected as root
- [x] The file opened by "View file" shows the worktree version of the file (not the main repo version)
- [x] `detectWorktreeBaseBranch` reads `baseBranch` from `<repo>/.grove/config.json` before falling back to auto-detection
- [x] Missing or malformed `.grove/config.json` falls through to auto-detection without errors
- [x] `selectedRoot` resets to null on workspace switch
- [x] If a selected worktree is removed (task moved to Done), the selector falls back to repo root
- [x] Expanded directories are persisted separately per root path (no cross-contamination between worktree and main repo)
- [x] No regressions: existing file browsing at workspace root works exactly as before when no worktree is selected

## Context for agent

### Implementation Order

1. Task 1 (backend validation) — unblocks everything, low risk
2. Task 4 (base branch config) — backend-only, isolated
3. Task 2 (worktree selector) — depends on Task 1
4. Task 3 (fix "View file") — depends on Task 2

### Key Files

- `src/main/ipc/filesystem.ts` — fs:tree and fs:readFile validation
- `src/main/filesystem.ts` — buildFileTree, readFileContent
- `src/renderer/src/stores/useFileStore.ts` — file store state
- `src/renderer/src/components/Files/FilesView.tsx` — files view container
- `src/renderer/src/components/Files/FileTree.tsx` — file tree component
- `src/renderer/src/components/TaskDetail/ChangesTab.tsx` — handleViewFile fix
- `src/main/git.ts` — detectWorktreeBaseBranch

### Security Model

- `isAllowedPath()` validates: direct workspace match OR path is under `<workspace>/.worktrees/`
- Existing `readFileContent` path traversal protection (`resolved.startsWith(workspacePath + path.sep)`) bounds reads to the worktree root
- `.grove/config.json` is read-only in this phase — no write IPC

### Edge Cases

- Worktree removed while selected: fallback to repo root
- No worktrees: hide selector
- expandedDirs: persisted per root path (already keyed by path string)
- File watchers: worktree file changes won't trigger `fs:treeChanged` — acceptable, user has Refresh and auto-refresh
