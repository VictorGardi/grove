# Phase 5 — Git Worktree Automation

## Implementation Plan

**Goal:** Dragging a card to Doing creates a git worktree, updates the task frontmatter, generates a `CONTEXT.md` for the agent, and shows the branch name on the card. Dragging to Done prompts to remove the worktree.

**Prerequisite:** Phases 1–4 complete. `simple-git` must be available (check `package.json`; if absent, install with `npm install simple-git`).

---

## Syntax Highlighting Question — Answered First

> "Is it possible to include syntax highlighting in phase 5 for different files in the file view? For example markdown, typescript, python etc?"

**This was already fully implemented in Phase 3.** The Shiki-powered file viewer in `src/renderer/src/components/Files/FileViewer.tsx` already supports TypeScript, TSX, JavaScript, JSX, Python, Go, Rust, SQL, YAML, JSON, Markdown, Bash, Dockerfile, CSS, HTML, TOML, XML, and GraphQL — all using a custom theme derived from the app's CSS variable palette. See `src/renderer/src/components/Files/shikiHighlighter.ts` and `shikiTheme.ts`.

**Phase 5 does not touch the file viewer.** Do not re-implement or duplicate syntax highlighting here. If specific languages are missing from the Phase 3 list, they should be added to the existing `shikiHighlighter.ts` singleton — that is a one-line change per language, not a Phase 5 concern.

---

## Spec Gaps and Ambiguities (Call-outs)

Before implementing, the following gaps in the VISION.md Phase 5 spec must be resolved. Decisions are documented here:

| #   | Gap / Ambiguity                                                                                                                                                                                           | Decision                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | `git:createWorktree` signature says `(repoPath, taskId, branchName)` but does not specify what to do if the branch already exists on the remote or locally                                                | If branch exists locally: reuse it with `git worktree add .worktrees/<id> <existing-branch>` (no `-b`). If it exists remotely only: create local branch tracking remote. See §Edge Cases.                                           |
| G2  | `git:worktrees(path)` — VISION.md lists this but the preload API names it `git.listWorktrees`. Use `git:listWorktrees` for consistency with the existing IPC channel naming convention.                   | Use channel `git:listWorktrees`.                                                                                                                                                                                                    |
| G3  | `git:isRepo(path)` — not currently in the preload API. Used internally in the drag-to-Doing guard but may not need a dedicated IPC channel.                                                               | Implement as an internal helper in `src/main/git.ts`. Expose via IPC only if renderer needs it directly (it does not in Phase 5).                                                                                                   |
| G4  | Drag to Done: the spec says "Clear `worktree` field from frontmatter" but does not mention clearing the `branch` field.                                                                                   | Clear both `worktree` and `branch` from frontmatter on confirmed worktree removal. The branch is kept in git but no longer tracked in the task file.                                                                                |
| G5  | CONTEXT.md path: spec says "generate into the worktree root". When `git worktree add` runs, the worktree directory is created with a checkout of the branch. `CONTEXT.md` is written into that directory. | Write `CONTEXT.md` to `<worktreePath>/CONTEXT.md` after `git worktree add` completes.                                                                                                                                               |
| G6  | Drag to Done: what if the task has no worktree set?                                                                                                                                                       | No-op — skip the worktree removal prompt entirely. Normal move proceeds.                                                                                                                                                            |
| G7  | Moving a task back from Doing to Backlog (not covered by spec).                                                                                                                                           | Do NOT remove the worktree. Update status in frontmatter. Preserve `worktree` and `branch` fields so the worktree remains accessible. Warn in UI: "Worktree preserved at `.worktrees/<id>`".                                        |
| G8  | Sidebar worktree list data source: should it list worktrees from `git worktree list` or from tasks with `worktree` set?                                                                                   | Use task records with `worktree` field set as the source — this is already available in the renderer without an extra IPC call. Call `git:listWorktrees` only to cross-validate on initial load.                                    |
| G9  | The spec says `git worktree add .worktrees/<id> -b <branch>` — this is a relative path. Relative to what?                                                                                                 | The command runs in `repoPath`, so the worktree lands at `<repoPath>/.worktrees/<taskId>/`. Store the relative path `".worktrees/<taskId>"` in frontmatter (matches existing VISION.md example: `worktree: .worktrees/feat/T-004`). |
| G10 | What is the base branch for the new worktree?                                                                                                                                                             | Use the workspace's current HEAD branch (the branch the main worktree is on). Fall back to `main`, then `master`. Do not require a remote.                                                                                          |
| G11 | Phase 6 handles terminal status. In Phase 5, the sidebar worktree list always shows status as "idle".                                                                                                     | Confirmed. Add a `terminalOpen` boolean field to the worktree list item type, always `false` in Phase 5, wired up in Phase 6.                                                                                                       |

---

## Part 1 — Main Process: Git Module

### 1.1 New file: `src/main/git.ts`

All git operations run in the main process via `simple-git`. Never shell out from the renderer.

```ts
import simpleGit, { SimpleGit } from "simple-git";
import * as path from "path";
import * as fs from "fs";

/** Returns a simple-git instance scoped to the given directory */
function git(cwd: string): SimpleGit {
  return simpleGit({ baseDir: cwd, binary: "git", maxConcurrentProcesses: 1 });
}

/**
 * Check whether a directory is a git repository.
 * Uses `git rev-parse --is-inside-work-tree` — fast, no network.
 */
export async function isGitRepo(repoPath: string): Promise<boolean>;

/**
 * List existing worktrees for a repo.
 * Runs `git worktree list --porcelain` and parses the output.
 * Returns an array of worktree descriptors.
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]>;

/**
 * Create a new worktree.
 *
 * Strategy:
 *   1. Check if <repoPath>/.worktrees/<taskId> already exists on disk.
 *      If yes and it is a valid worktree: return existing info (idempotent).
 *   2. Check if the branch already exists locally.
 *      - If yes: `git worktree add .worktrees/<taskId> <branchName>` (no -b)
 *      - If no:  `git worktree add .worktrees/<taskId> -b <branchName>`
 *   3. Returns the absolute path of the new worktree.
 *
 * @param repoPath    Absolute path to the git repo root
 * @param taskId      Task ID (e.g. "T-004") — used as the directory name
 * @param branchName  Branch name (e.g. "feat/T-004-jwt-refresh")
 * @returns           Absolute path to the created worktree
 * @throws            WorktreeError with a `code` field (see §1.2)
 */
export async function createWorktree(
  repoPath: string,
  taskId: string,
  branchName: string,
): Promise<string>;

/**
 * Remove a worktree.
 * Runs `git worktree remove <worktreePath> --force`.
 * --force is required because the working tree may have untracked files
 * (e.g. CONTEXT.md which is untracked).
 *
 * Does NOT delete the branch.
 *
 * @param repoPath     Absolute path to the git repo root
 * @param worktreePath Absolute or relative path to the worktree
 * @throws             WorktreeError with code 'NOT_FOUND' if path doesn't exist
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
): Promise<void>;

/**
 * Detect the default base branch for a repo.
 * Order: HEAD branch → 'main' (if exists) → 'master' (if exists) → null.
 * Null means the repo has no commits yet (empty repo).
 */
export async function detectBaseBranch(
  repoPath: string,
): Promise<string | null>;
```

### 1.2 Error Types

```ts
// src/main/git.ts (exported)

export type WorktreeErrorCode =
  | "NOT_A_REPO" // directory is not a git repository
  | "NOT_FOUND" // worktree path does not exist
  | "ALREADY_EXISTS" // worktree directory already exists but is not a valid worktree
  | "BRANCH_LOCKED" // branch is checked out in another worktree
  | "DIRTY_WORKING_TREE" // cannot remove worktree with uncommitted changes (use --force)
  | "DETACHED_HEAD" // repo is in detached HEAD state
  | "EMPTY_REPO" // repo has no commits, cannot create worktree
  | "GIT_NOT_FOUND" // git binary not on PATH
  | "UNKNOWN"; // catch-all for unexpected git errors

export class WorktreeError extends Error {
  constructor(
    public readonly code: WorktreeErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "WorktreeError";
  }
}
```

### 1.3 `WorktreeInfo` type

Add to `src/shared/types.ts`:

```ts
// ── Phase 5: Worktrees ────────────────────────────────────────────

/**
 * A single entry from `git worktree list --porcelain`.
 * The main worktree (repo root) is included in this list.
 */
export interface WorktreeInfo {
  /** Absolute path to the worktree directory */
  path: string;
  /** Current HEAD commit SHA (40 chars) */
  head: string;
  /** Branch ref (e.g. "refs/heads/feat/T-004"), or null if detached */
  branch: string | null;
  /** Short branch name (e.g. "feat/T-004"), derived from `branch` */
  branchShort: string | null;
  /** Whether this is the main (primary) worktree */
  isMain: boolean;
  /** Whether the worktree is bare */
  isBare: boolean;
  /** Whether the worktree HEAD is detached */
  isDetached: boolean;
  /**
   * Whether a terminal is open for this worktree.
   * Always false in Phase 5. Wired up in Phase 6.
   */
  terminalOpen: boolean;
}
```

### 1.4 Branch Naming Strategy

**Function:** `export function deriveBranchName(taskId: string, title: string): string`

Location: `src/main/git.ts`

**Rules:**

1. Prefix: always `feat/`
2. Append `<taskId>` in lowercase: `t-004`
3. Append `-` + title slug: lowercase, replace `[^a-z0-9]+` with `-`, strip leading/trailing hyphens, max **30 chars** for the title part (git branch names have no hard limit but long names are unwieldy in the terminal prompt)
4. Final format: `feat/<taskId-lower>-<title-slug>` e.g. `feat/t-004-jwt-refresh-token`

```ts
export function deriveBranchName(taskId: string, title: string): string {
  const idPart = taskId.toLowerCase(); // "t-004"
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30)
    .replace(/-$/, "");
  return `feat/${idPart}-${slug || "task"}`;
}
```

**Conflict resolution:**

- Before calling `git worktree add -b <branch>`, check if the branch exists locally via `git branch --list <branch>`.
- If it exists locally: call `git worktree add .worktrees/<taskId> <branch>` (no `-b` flag). This reuses the existing branch.
- If it exists remotely but not locally: call `git worktree add .worktrees/<taskId> -b <branch> --track origin/<branch>` if the remote branch exists.
- The `createWorktree` function handles this branching logic internally — callers always pass `(repoPath, taskId, branchName)` and get back the worktree path.

**Uniqueness guarantee:** Because `branchName` includes the task ID (globally unique per repo), branch name collisions are only possible if the same task is processed twice. The idempotency check (step 1 in `createWorktree`) handles this correctly.

---

## Part 2 — Main Process: IPC Handlers

### 2.1 New IPC channels

**File:** `src/main/ipc/git.ts` (new)

```ts
import { ipcMain } from "electron";
import type { IpcResult, WorktreeInfo } from "@shared/types";
import {
  listWorktrees,
  createWorktree,
  removeWorktree,
  WorktreeError,
} from "../git";

export function registerGitHandlers(): void {
  // ...
}
```

| Channel              | Signature                                                | Returns                                                   | Notes                  |
| -------------------- | -------------------------------------------------------- | --------------------------------------------------------- | ---------------------- |
| `git:listWorktrees`  | `(repoPath: string)`                                     | `IpcResult<WorktreeInfo[]>`                               | Includes main worktree |
| `git:createWorktree` | `(repoPath: string, taskId: string, branchName: string)` | `IpcResult<{ worktreePath: string; branchName: string }>` | Idempotent             |
| `git:removeWorktree` | `(repoPath: string, worktreePath: string)`               | `IpcResult<void>`                                         | Does not delete branch |

**Exact IPC handler signatures:**

```ts
ipcMain.handle(
  "git:listWorktrees",
  async (_event, repoPath: string): Promise<IpcResult<WorktreeInfo[]>> => {
    try {
      const worktrees = await listWorktrees(repoPath);
      return { ok: true, data: worktrees };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
);

ipcMain.handle(
  "git:createWorktree",
  async (
    _event,
    repoPath: string,
    taskId: string,
    branchName: string,
  ): Promise<IpcResult<{ worktreePath: string; branchName: string }>> => {
    try {
      // Validate inputs
      if (!repoPath || !taskId || !branchName) {
        return {
          ok: false,
          error: "repoPath, taskId, and branchName are required",
        };
      }
      if (!/^T-\d+$/.test(taskId)) {
        return { ok: false, error: `Invalid taskId format: ${taskId}` };
      }
      if (!/^[a-zA-Z0-9_/.-]+$/.test(branchName)) {
        return { ok: false, error: `Invalid branch name: ${branchName}` };
      }
      const worktreePath = await createWorktree(repoPath, taskId, branchName);
      return { ok: true, data: { worktreePath, branchName } };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
);

ipcMain.handle(
  "git:removeWorktree",
  async (
    _event,
    repoPath: string,
    worktreePath: string,
  ): Promise<IpcResult<void>> => {
    try {
      await removeWorktree(repoPath, worktreePath);
      return { ok: true, data: undefined };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
);
```

**Register in `src/main/ipc/index.ts`:**

```ts
import { registerGitHandlers } from "./git";

export function registerIpcHandlers(
  configManager: ConfigManager,
  mainWindow: BrowserWindow,
): void {
  registerWorkspaceHandlers(configManager, mainWindow);
  registerTaskHandlers();
  registerFilesystemHandlers(configManager, mainWindow);
  registerGitHandlers();
  ipcMain.handle("app:getPlatform", () => process.platform);
}
```

### 2.2 CONTEXT.md Generator

**File:** `src/main/contextGenerator.ts` (new)

```ts
import * as path from "path";
import * as fs from "fs";
import matter from "gray-matter";
import type { TaskInfo, MilestoneInfo } from "@shared/types";

/**
 * Generate and write CONTEXT.md into the worktree root.
 *
 * @param worktreePath   Absolute path to the worktree directory
 * @param task           The full TaskInfo for the task
 * @param taskBody       Full markdown body of the task file
 * @param decisions      Array of { id, title, body } for linked decisions
 * @param milestone      The linked milestone (or null)
 */
export async function generateContextFile(
  worktreePath: string,
  task: TaskInfo,
  taskBody: string,
  decisions: DecisionContent[],
  milestone: MilestoneInfo | null,
): Promise<void>;

export interface DecisionContent {
  id: string;
  title: string;
  body: string;
}
```

The generator reads decision files directly from `<workspacePath>/.decisions/` using `gray-matter`. The IPC handler is responsible for reading the task body and decision contents before calling this function.

**CONTEXT.md Template:**

```markdown
# Task Context: <task.title>

> Generated by Grove on <ISO date>. Do not edit — regenerated on each worktree creation.

## Task

**ID:** <task.id>
**Branch:** <task.branch>
**Priority:** <task.priority | 'not set'>
**Agent:** <task.agent | 'not set'>

## Description

<## Description section from task body, or "(no description provided)">

## Definition of Done

<full DoD checklist from task body, preserving `- [x]` and `- [ ]` state>

## Context for Agent

<## Context for agent section from task body, or "(no context provided)">

<-- MILESTONE SECTION: only rendered if task.milestone is set -->

## Milestone: <milestone.title>

**ID:** <milestone.id>

<milestone description body>

<-- DECISIONS SECTION: only rendered if task.decisions is non-empty -->

## Linked Decisions

<-- Repeated for each linked decision -->

### <decision.id>: <decision.title>

<full decision body>

---
```

**Exact format (with example values):**

```markdown
# Task Context: JWT refresh token rotation

> Generated by Grove on 2026-04-03. Do not edit — regenerated on each worktree creation.

## Task

**ID:** T-004
**Branch:** feat/t-004-jwt-refresh-token
**Priority:** high
**Agent:** claude-code

## Description

Implement secure refresh token rotation with revocation support using Redis.

## Definition of Done

- [x] Refresh endpoint issues new token pair
- [x] Old token added to Redis revocation set
- [ ] TTL cleanup job for expired entries
- [ ] Integration tests covering rotation flow

## Context for Agent

See D-002. Use existing Redis client from src/lib/redis.ts.
Follow error handling patterns in src/middleware/errors.ts.
Tests in Vitest.

## Milestone: v1.0 Launch

**ID:** M-001

First public release. Core auth, API endpoints, and admin dashboard.

## Linked Decisions

### D-002: Use Redis for session and token state

## Context

Needed fast revocation lookups without DB round-trips.

## Decision

Use Redis with TTL-based expiry for token revocation lists and session state.

## Consequences

- Adds Redis as a dependency
- Cleanup is automatic via TTL
- +~2ms latency on token validation (acceptable)

---
```

**Notes on generation:**

- Parse `taskBody` using the existing `parseTaskBody` utility from Phase 4 (`src/renderer/src/utils/taskBodyParser.ts`). However, since the generator runs in the main process, **duplicate the parsing logic** in `src/main/contextGenerator.ts` — do not import renderer-side code into main. Alternatively, move `parseTaskBody` to `src/shared/taskBodyParser.ts` so both can import it. **Recommended: move to `src/shared/`.**
- Decision files are read from `<workspacePath>/.decisions/D-XXX-*.md` by matching the ID prefix.
- If a decision file is not found (e.g. was deleted), include a note: `> Note: Decision file not found.`
- `CONTEXT.md` is not tracked in `.gitignore` by default — it is committed with the branch, making it available to the agent even after a fresh `git clone`.
- Write using the existing `atomicWrite` utility: `await atomicWrite(path.join(worktreePath, 'CONTEXT.md'), content)`.

### 2.3 Drag-to-Doing Orchestration

The drag-to-Doing worktree creation sequence runs entirely in the main process, triggered by a **new IPC channel** `git:setupWorktreeForTask`. This avoids chatty back-and-forth between renderer and main for a multi-step operation.

**New IPC channel: `git:setupWorktreeForTask`**

```ts
// Input
interface SetupWorktreeInput {
  workspacePath: string; // repo root
  taskFilePath: string; // absolute path to the task .md file
  taskId: string; // e.g. "T-004"
  taskTitle: string; // used to derive branch name
}

// Output
interface SetupWorktreeResult {
  worktreePath: string; // relative path, e.g. ".worktrees/T-004"
  branchName: string; // e.g. "feat/t-004-jwt-refresh-token"
  alreadyExisted: boolean; // true if worktree was already set up (idempotent)
}
```

Handler sequence (runs in main process, all operations serial):

```
1. Derive branchName from (taskId, taskTitle)
2. Compute worktreePath = path.join(workspacePath, '.worktrees', taskId)
3. Check if worktreePath directory exists AND is a valid worktree:
   a. If yes → skip to step 6 (idempotent, alreadyExisted = true)
4. Call createWorktree(workspacePath, taskId, branchName)
   → On error: throw WorktreeError with appropriate code
5. Read task body from taskFilePath (for CONTEXT.md generation)
6. Read linked decision files from workspacePath/.decisions/
7. Read linked milestone file (if task.milestone is set)
8. Call generateContextFile(worktreePath, task, body, decisions, milestone)
9. Call updateTask(workspacePath, taskFilePath, {
     worktree: `.worktrees/${taskId}`,
     branch: branchName,
   })
   (does NOT update status — the drag operation already called task:move)
10. Return { worktreePath: `.worktrees/${taskId}`, branchName, alreadyExisted }
```

**Important:** `task:move` and `git:setupWorktreeForTask` are called **sequentially** in the renderer. The move happens first (so the file is already in `.tasks/doing/`), then worktree setup. This ordering matters because `updateTask` in step 9 reads from the new path.

### 2.4 Drag-to-Done Orchestration

**New IPC channel: `git:teardownWorktreeForTask`**

```ts
// Input
interface TeardownWorktreeInput {
  workspacePath: string;
  taskFilePath: string; // absolute path to the task .md file (already in .tasks/done/)
  worktreePath: string; // relative or absolute path stored in frontmatter
}

// Output: IpcResult<void>
```

Handler sequence:

```
1. Resolve absolute path of worktreePath
2. Check if directory exists — if not, proceed silently (already gone)
3. Call removeWorktree(workspacePath, absoluteWorktreePath)
   → On WorktreeError with code DIRTY_WORKING_TREE:
     return { ok: false, error: 'Worktree has uncommitted changes. Remove manually.' }
   → On other errors: return { ok: false, error: err.message }
4. Call updateTask(workspacePath, taskFilePath, { worktree: null, branch: null })
5. Return { ok: true, data: undefined }
```

**Note:** The `--force` flag is passed to `git worktree remove` unconditionally (see §1.1). This handles the case where `CONTEXT.md` is untracked. If the agent has uncommitted changes in tracked files, git will still refuse with an error — this is the correct behavior (the user must commit or stash first). However, `simple-git`'s `worktree.remove` does not expose a `--force` flag cleanly; use `git.raw(['worktree', 'remove', '--force', absoluteWorktreePath])` directly.

---

## Part 3 — Renderer: Drag-to-Doing Flow

### 3.1 Modified drag handler in `Board.tsx`

The existing `onDragEnd` in `Board.tsx` calls `moveTask(task.filePath, toStatus)`. Extend it for the `doing` case:

```ts
// src/renderer/src/components/Board/Board.tsx

async function handleDragEnd(event: DragEndEvent): Promise<void> {
  const { active, over } = event;
  if (!over) return;

  const taskId = active.id as string;
  const toStatus = over.id as TaskStatus;
  const task = useDataStore.getState().tasks.find((t) => t.id === taskId);
  if (!task || task.status === toStatus) return;

  if (toStatus === "done" && task.worktree) {
    // Handled separately — see §3.3
    await handleDragToDone(task);
    return;
  }

  // Optimistic UI update (move card visually before IPC completes)
  useDataStore.getState().patchTask({ ...task, status: toStatus });

  const ok = await moveTask(task.filePath, toStatus);
  if (!ok) {
    // Rollback optimistic update
    useDataStore.getState().patchTask(task);
    showToast("Failed to move task", "error");
    return;
  }

  if (toStatus === "doing") {
    await handleDragToDoing(task);
  }
}
```

### 3.2 `handleDragToDoing` — full sequence

```ts
// src/renderer/src/components/Board/Board.tsx (or extracted to taskActions.ts)

async function handleDragToDoing(task: TaskInfo): Promise<void> {
  const wp = getWorkspacePath();
  if (!wp) return;

  // Check if workspace is a git repo (guard — non-git repos skip silently)
  // isGitRepo check is implicit: if git:setupWorktreeForTask returns NOT_A_REPO,
  // we show a dismissible warning rather than a blocking error.

  // Set loading state on the card (visual feedback)
  useDataStore.getState().patchTask({ ...task, _worktreeCreating: true });

  const result = await window.api.git.setupWorktreeForTask({
    workspacePath: wp,
    taskFilePath: task.filePath,
    taskId: task.id,
    taskTitle: task.title,
  });

  // Clear loading state
  useDataStore.getState().patchTask({ ...task, _worktreeCreating: false });

  if (!result.ok) {
    // Map error code to user-facing message — see §6 Error Handling Matrix
    showWorktreeError(result.error);
    return;
  }

  // Patch the store immediately with worktree + branch info
  const updatedTask = useDataStore
    .getState()
    .tasks.find((t) => t.id === task.id);
  if (updatedTask) {
    useDataStore.getState().patchTask({
      ...updatedTask,
      worktree: result.data.worktreePath,
      branch: result.data.branchName,
    });
  }

  if (!result.data.alreadyExisted) {
    showToast(`Worktree created: ${result.data.branchName}`, "success");
  }
}
```

**Loading state on card:** Add `_worktreeCreating?: boolean` as a transient UI flag to `TaskInfo` (or handle via a separate `useWorktreeStore`). The card renders a subtle spinner or pulsing border while `_worktreeCreating` is true. This field is **never persisted** — it is only set in-memory during the IPC call.

**Recommended approach:** Use a separate `Set<string>` in the store (task IDs currently creating a worktree) rather than mutating `TaskInfo`. See §5 Zustand Store Changes.

### 3.3 `handleDragToDone` — confirmation dialog

```ts
async function handleDragToDone(task: TaskInfo): Promise<void> {
  const wp = getWorkspacePath();
  if (!wp) return;

  // Show confirmation dialog
  const confirmed = await showWorktreeRemovalDialog(task);
  if (!confirmed) return; // user cancelled — do not move task

  // Move task to done first (optimistic)
  useDataStore.getState().patchTask({ ...task, status: "done" });
  const moveOk = await moveTask(task.filePath, "done");
  if (!moveOk) {
    useDataStore.getState().patchTask(task); // rollback
    showToast("Failed to move task to Done", "error");
    return;
  }

  // Get updated filePath after move (task is now in .tasks/done/)
  const movedTask = useDataStore.getState().tasks.find((t) => t.id === task.id);
  if (!movedTask) return;

  // Tear down worktree
  const result = await window.api.git.teardownWorktreeForTask({
    workspacePath: wp,
    taskFilePath: movedTask.filePath,
    worktreePath: task.worktree!,
  });

  if (!result.ok) {
    // Worktree removal failed — task is already moved to Done
    // Show non-blocking warning (do not rollback the task move)
    showToast(
      `Task moved to Done, but worktree removal failed: ${result.error}`,
      "warning",
    );
    return;
  }

  // Patch store: clear worktree + branch
  useDataStore.getState().patchTask({
    ...movedTask,
    worktree: null,
    branch: null,
  });

  showToast("Task done. Worktree removed. Branch kept.", "success");
}
```

### 3.4 Confirmation Dialog Component

**File:** `src/renderer/src/components/shared/ConfirmDialog.tsx` (new — reusable)

```tsx
interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  onConfirm: () => void;
  onCancel: () => void;
}
```

For the worktree removal case, the dialog content is:

```
Title:   Remove worktree?
Message: The branch "feat/t-004-jwt-refresh-token" will be kept.
         The working tree at .worktrees/T-004 will be deleted.
Confirm: Remove worktree
Cancel:  Keep worktree
```

**Implementation note:** Do NOT use `window.confirm()`. It is a synchronous blocking call that freezes the Electron renderer. Use a React portal-based modal dialog. The dialog returns a `Promise<boolean>` via an imperative helper:

```ts
// src/renderer/src/utils/dialogs.ts
export function showWorktreeRemovalDialog(task: TaskInfo): Promise<boolean>;
```

This sets state in a `useDialogStore` Zustand store that renders the `<ConfirmDialog>` at the app root level, and resolves the promise when the user clicks confirm or cancel.

---

## Part 4 — Renderer: Sidebar Worktree Section

### 4.1 Data source

The worktree list is derived from the existing `tasks` array in `useDataStore`. No additional IPC call is needed on every render:

```ts
// Derived selector
export const useActiveWorktrees = (): WorktreeDisplayItem[] =>
  useDataStore((s) =>
    s.tasks
      .filter((t) => t.status === "doing" && t.worktree !== null)
      .map((t) => ({
        taskId: t.id,
        taskTitle: t.title,
        branch: t.branch ?? "(unknown branch)",
        worktreePath: t.worktree!,
        terminalOpen: false, // Phase 6 wires this up
      })),
  );

export interface WorktreeDisplayItem {
  taskId: string;
  taskTitle: string;
  branch: string;
  worktreePath: string;
  terminalOpen: boolean;
}
```

### 4.2 Sidebar Worktree Section Component

**File:** `src/renderer/src/components/Sidebar/WorktreeList.tsx` (new)
**Styles:** `src/renderer/src/components/Sidebar/WorktreeList.module.css` (new)

**Render only when there are active worktrees.** No empty state — if no worktrees, the section is hidden entirely.

```
┌──────────────────────────────┐
│  WORKTREES                   │  ← section label, same style as "WORKSPACES"
│                              │
│  ⎇ feat/t-004-jwt-refresh    │  ← branch icon + short branch name
│    T-004 · JWT refresh tok…  │  ← task ID in mono + title (truncated, 1 line)
│    ● idle                    │  ← status dot (gray = idle, green = running in Phase 6)
│                              │
│  ⎇ feat/t-007-admin-panel    │
│    T-007 · Admin dashboard   │
│    ● idle                    │
└──────────────────────────────┘
```

**Layout details:**

- Section label: `WORKTREES`, uppercase, `--text-lo` color, same `sectionLabel` CSS class as the Workspaces section
- Each row:
  - Top line: `⎇` (git branch glyph, U+2387) + branch name in `--font-mono` 12px, `--text-secondary`
  - Middle line: task ID in `--font-mono` 11px `--text-lo` + `·` separator + task title truncated with ellipsis, `--text-secondary`
  - Bottom line: colored dot + status text. Dot color: `--text-lo` (gray) for idle. In Phase 6: `--status-green` for running.
- Row hover: `--bg-hover` background
- Clicking a row: navigate to the board view and select that task (`setActiveView('board')` + `setSelectedTask(taskId)`)
- Row height: auto (3 lines of text, 6px padding top/bottom)

**Placement in `Sidebar.tsx`:** Insert `<WorktreeList />` between the workspace list area and the bottom nav, inside its own `div` with a top border (`--border`). Only render if `worktrees.length > 0`.

### 4.3 Sidebar.tsx modification

```tsx
// src/renderer/src/components/Sidebar/Sidebar.tsx

import { WorktreeList } from "./WorktreeList";
import { useActiveWorktrees } from "../../stores/useDataStore";

export function Sidebar(): React.JSX.Element {
  const worktrees = useActiveWorktrees();

  return (
    <div className={styles.sidebar}>
      <AppWordmark />
      <div className={styles.workspaceListArea}>
        <div className={styles.sectionLabel}>Workspaces</div>
        <WorkspaceList />
      </div>

      {worktrees.length > 0 && (
        <div className={styles.worktreeListArea}>
          <WorktreeList worktrees={worktrees} />
        </div>
      )}

      <div className={styles.bottomSection}>
        <BottomNav />
      </div>
    </div>
  );
}
```

---

## Part 5 — Renderer: Branch Name on Card

### 5.1 TaskCard modification

When `task.branch` is set (non-null), display it below the title row.

```tsx
// src/renderer/src/components/Board/TaskCard.tsx

{
  /* Branch badge — shown when worktree is active */
}
{
  task.branch && (
    <div className={styles.branchRow}>
      <span className={styles.branchIcon}>⎇</span>
      <span className={styles.branchName}>{task.branch}</span>
    </div>
  );
}
```

**CSS (`TaskCard.module.css`):**

```css
.branchRow {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

.branchIcon {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-lo);
  flex-shrink: 0;
}

.branchName {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}
```

**Position:** Between the title row and the description preview. The branch row replaces no existing element — it is additive.

**Loading state:** While `worktreeCreatingIds.has(task.id)`, show a pulsing placeholder instead of the branch row:

```tsx
{
  worktreeCreating && (
    <div className={styles.branchRow}>
      <span className={styles.branchCreating}>Creating worktree…</span>
    </div>
  );
}
```

---

## Part 6 — Zustand Store Changes

### 6.1 New `useWorktreeStore`

**File:** `src/renderer/src/stores/useWorktreeStore.ts` (new)

Rather than polluting `useDataStore` with transient worktree UI state, create a lean dedicated store:

```ts
interface WorktreeState {
  /** Task IDs currently in the process of creating a worktree */
  creatingIds: Set<string>;

  markCreating: (taskId: string) => void;
  markCreated: (taskId: string) => void;
}

export const useWorktreeStore = create<WorktreeState>()((set) => ({
  creatingIds: new Set(),

  markCreating: (taskId) =>
    set((s) => ({ creatingIds: new Set([...s.creatingIds, taskId]) })),

  markCreated: (taskId) =>
    set((s) => {
      const next = new Set(s.creatingIds);
      next.delete(taskId);
      return { creatingIds: next };
    }),
}));
```

**Usage:**

```ts
// In handleDragToDoing:
useWorktreeStore.getState().markCreating(task.id)
const result = await window.api.git.setupWorktreeForTask(...)
useWorktreeStore.getState().markCreated(task.id)
```

**In TaskCard:**

```tsx
const worktreeCreating = useWorktreeStore((s) => s.creatingIds.has(task.id));
```

### 6.2 No changes to `useDataStore`

The existing `patchTask` action is sufficient to update `worktree` and `branch` on `TaskInfo` after worktree creation/removal. No new fields are required in `useDataStore`.

### 6.3 Dialog store (for `ConfirmDialog`)

**File:** `src/renderer/src/stores/useDialogStore.ts` (new)

```ts
interface DialogState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: "default" | "destructive";
  resolve: ((confirmed: boolean) => void) | null;

  show: (
    options: Omit<
      DialogState,
      "open" | "resolve" | "show" | "confirm" | "cancel"
    >,
  ) => Promise<boolean>;
  confirm: () => void;
  cancel: () => void;
}
```

---

## Part 7 — Preload API Extension

### 7.1 `src/preload/index.ts` additions

```ts
git: {
  listWorktrees: (repoPath: string) =>
    ipcRenderer.invoke('git:listWorktrees', repoPath),
  setupWorktreeForTask: (input: {
    workspacePath: string
    taskFilePath: string
    taskId: string
    taskTitle: string
  }) => ipcRenderer.invoke('git:setupWorktreeForTask', input),
  teardownWorktreeForTask: (input: {
    workspacePath: string
    taskFilePath: string
    worktreePath: string
  }) => ipcRenderer.invoke('git:teardownWorktreeForTask', input),
},
```

### 7.2 `src/preload/index.d.ts` additions

```ts
git: {
  listWorktrees: (repoPath: string) => Promise<IpcResult<WorktreeInfo[]>>;
  setupWorktreeForTask: (input: {
    workspacePath: string;
    taskFilePath: string;
    taskId: string;
    taskTitle: string;
  }) =>
    Promise<
      IpcResult<{
        worktreePath: string;
        branchName: string;
        alreadyExisted: boolean;
      }>
    >;
  teardownWorktreeForTask: (input: {
    workspacePath: string;
    taskFilePath: string;
    worktreePath: string;
  }) => Promise<IpcResult<void>>;
}
```

Import `WorktreeInfo` from `@shared/types` at the top of the file.

---

## Part 8 — Error Handling Matrix

Every failure mode, the internal error code, and the user-facing response:

| Scenario                                                              | Error Code                      | User-Facing Response                                                                                                                  | Rollback?                                                                       |
| --------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Workspace is not a git repo                                           | `NOT_A_REPO`                    | Toast: "This workspace is not a git repository. Worktree creation skipped."                                                           | No rollback on task move — task moves to Doing without a worktree               |
| Git binary not found on PATH                                          | `GIT_NOT_FOUND`                 | Toast: "git not found. Install git and restart Grove."                                                                                | No rollback on task move                                                        |
| Repo has no commits yet                                               | `EMPTY_REPO`                    | Toast: "Cannot create worktree: repository has no commits yet. Make an initial commit first."                                         | No rollback                                                                     |
| Branch already checked out in another worktree                        | `BRANCH_LOCKED`                 | Toast: "Branch already open in another worktree. Close that worktree first."                                                          | Rollback task move back to previous status                                      |
| Worktree directory exists but is corrupted (not a valid git worktree) | `ALREADY_EXISTS`                | Toast: "Worktree directory already exists but is not a valid git worktree. Remove `.worktrees/T-XXX` manually and try again."         | No rollback                                                                     |
| Repo is in detached HEAD state                                        | `DETACHED_HEAD`                 | Toast: "Repository is in detached HEAD state. Checkout a branch first."                                                               | No rollback on task move                                                        |
| Disk full / permission error during worktree creation                 | `UNKNOWN` (ENOSPC / EACCES)     | Toast: "Failed to create worktree: [error message]"                                                                                   | Rollback task move                                                              |
| `task:move` fails (before worktree creation)                          | — (IPC error)                   | Toast: "Failed to move task: [error message]"                                                                                         | Nothing to rollback — move failed before any worktree was touched               |
| `CONTEXT.md` write fails                                              | — (file error)                  | Non-blocking warning toast: "Worktree created but CONTEXT.md could not be written: [error]". Task move and worktree creation succeed. | No rollback — worktree is valid, just missing CONTEXT.md                        |
| `task:update` (setting worktree/branch) fails after worktree created  | — (IPC error)                   | Non-blocking warning: "Worktree created but task file could not be updated. Frontmatter may be stale."                                | No rollback — worktree is valid. User must manually update or re-trigger.       |
| Drag to Done — `git worktree remove` fails with dirty working tree    | `DIRTY_WORKING_TREE` (implicit) | Toast: "Worktree has changes. Commit or stash them first, then remove manually."                                                      | Task is already moved to Done. Worktree persists. `worktree` field NOT cleared. |
| Drag to Done — worktree directory already gone                        | — (no error)                    | Silent success — proceed as if removed                                                                                                | N/A                                                                             |
| Drag to Done — `task:update` to clear fields fails                    | — (IPC error)                   | Non-blocking warning: "Task moved to Done but frontmatter could not be cleared."                                                      | Task is in Done. Worktree is removed. Fields may be stale.                      |

**Rollback definition:** When a rollback is specified, call `moveTask(task.filePath, originalStatus)` to undo the column move. Apply the optimistic `patchTask` rollback in the store simultaneously.

**Toast system:** Phase 5 introduces a lightweight toast notification system. Add a `useToastStore` (or extend `useDialogStore`) that renders a stack of toast messages in a fixed corner overlay. Toasts auto-dismiss after 5 seconds. Variants: `success` (green), `warning` (amber), `error` (red).

---

## Part 9 — Edge Cases

### 9.1 Detached HEAD

`git worktree add -b <branch>` requires the repo to be on a branch, not in detached HEAD state. The `createWorktree` function checks for detached HEAD before attempting the command. Detection: `git rev-parse --abbrev-ref HEAD` returns `HEAD` (literally) when detached.

### 9.2 Dirty working tree

Creating a worktree does NOT require a clean working tree. The main worktree can have uncommitted changes — `git worktree add` is branch-based, not state-based. This is not an error.

Removing a worktree (`git worktree remove`) **does** fail if the worktree has uncommitted changes to tracked files. Passing `--force` bypasses this for untracked files only. If the agent has uncommitted tracked-file changes, the removal will fail — show the `DIRTY_WORKING_TREE` error message.

### 9.3 Locked worktrees

If `git worktree list --porcelain` shows `locked` for a worktree (e.g. from a crashed process that left a lock file), `git worktree remove` will refuse. Detection: parse `locked` line in porcelain output. User-facing message: "Worktree is locked. Run `git worktree unlock <path>` in the terminal, then try again."

### 9.4 Branch already exists (locally)

Handled by the conflict resolution in `createWorktree` — reuse the existing branch without `-b`. The worktree will check out the existing local branch at its current HEAD. `CONTEXT.md` is still written/overwritten.

### 9.5 Branch already exists (remotely only)

Detection: `git branch -r --list origin/<branchName>`. If found: `git worktree add .worktrees/<taskId> -b <branchName> --track origin/<branchName>`. This creates a local branch tracking the remote.

### 9.6 Repo without remote

Not an error. `deriveBranchName` and `createWorktree` do not require a remote. `detectBaseBranch` uses local branches only. Everything works fine with a local-only repo.

### 9.7 Moving a task back from Doing to Backlog

The VISION.md spec does not address this. Decision: **do NOT remove the worktree.**

Behavior:

1. `task:move` runs normally — file moves to `.tasks/backlog/`
2. `worktree` and `branch` fields are **preserved** in frontmatter
3. No `git:setupWorktreeForTask` or `git:teardownWorktreeForTask` is called
4. The worktree list in the sidebar disappears (it only shows tasks with `status === 'doing'`)
5. The branch badge appears on the backlog card (since `task.branch` is still set) — this is intentional: it signals that a worktree exists for this task

**Rationale:** Silently removing a worktree when a user moves back to Backlog could destroy in-progress work. Preserving it and showing the branch on the card is the safer default. Phase 6 can add an explicit "Remove worktree" button in the task detail panel.

### 9.8 Task moved directly from Backlog to Done (never via Doing)

No worktree was ever created. `task.worktree` is null. Skip the worktree removal prompt entirely. Normal move proceeds.

### 9.9 `.worktrees/` directory in `.gitignore`

The `.worktrees/` directory is the worktree storage location. Git worktrees must NOT be inside the main repo's tracked tree (git enforces this — you cannot create a worktree inside `.git/`, and it will warn if the path is tracked). However, `.worktrees/` is already excluded from the file tree viewer (see `src/main/watchers.ts` and `filesystem.ts`). Instruct users (via CONTEXT.md or onboarding docs) to add `.worktrees/` to `.gitignore` to avoid accidentally staging the worktree directories.

**Automatic `.gitignore` update:** On first worktree creation for a workspace, check if `.worktrees/` is already in the root `.gitignore`. If not, append it:

```ts
// In createWorktree, after successful git worktree add:
await ensureWorktreesIgnored(repoPath);

async function ensureWorktreesIgnored(repoPath: string): Promise<void> {
  const gitignorePath = path.join(repoPath, ".gitignore");
  let content = "";
  try {
    content = await fs.promises.readFile(gitignorePath, "utf-8");
  } catch {
    // .gitignore doesn't exist — will create it
  }
  if (content.includes(".worktrees/")) return;
  const append = content.endsWith("\n") ? ".worktrees/\n" : "\n.worktrees/\n";
  await fs.promises.appendFile(gitignorePath, append, "utf-8");
}
```

This is a non-atomic append (safe here because `.gitignore` changes are low-frequency and no other process is writing it simultaneously during worktree creation).

### 9.10 Multiple rapid drags to Doing

If a user drags two tasks to Doing in rapid succession, two concurrent `git:setupWorktreeForTask` calls are issued. Since each targets a different directory (`.worktrees/T-004` vs `.worktrees/T-007`), there is no conflict. The `createWorktree` calls run concurrently on different paths.

### 9.11 Workspace switch while worktree creation is in-flight

The `useWorktreeStore.creatingIds` set is cleared on workspace switch (add a `clear()` action and call it in the workspace switch effect in `App.tsx`). The in-flight IPC call may still complete — its `patchTask` will no-op because `useDataStore` was also cleared on workspace switch.

---

## Part 10 — Testing Strategy

### 10.1 Main Process Unit Tests

**File:** `src/main/__tests__/git.test.ts` (new)

Use a real temporary git repo created with `tmp` + `simple-git` in `beforeEach`. Tests run against actual git operations — no mocking of `simple-git`.

| Test                                       | Description                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `isGitRepo` — valid repo                   | Returns true for a directory initialized with `git init`                     |
| `isGitRepo` — non-repo                     | Returns false for a plain directory                                          |
| `deriveBranchName` — basic                 | `T-004` + `JWT refresh token rotation` → `feat/t-004-jwt-refresh-token-rota` |
| `deriveBranchName` — special chars         | `T-001` + `Fix: DB connection (prod!)` → `feat/t-001-fix-db-connection-prod` |
| `deriveBranchName` — empty title           | `T-001` + `""` → `feat/t-001-task`                                           |
| `createWorktree` — happy path              | Creates `.worktrees/T-004`, checks out new branch                            |
| `createWorktree` — idempotent              | Calling twice returns existing worktree path, no error                       |
| `createWorktree` — branch exists locally   | Reuses existing branch without `-b`                                          |
| `createWorktree` — empty repo              | Throws `WorktreeError` with code `EMPTY_REPO`                                |
| `removeWorktree` — happy path              | Removes worktree directory and deregisters from git                          |
| `removeWorktree` — already gone            | Completes without error                                                      |
| `listWorktrees` — main only                | Returns array with one entry (the main worktree)                             |
| `listWorktrees` — with worktrees           | Returns main + each added worktree                                           |
| `ensureWorktreesIgnored` — no gitignore    | Creates `.gitignore` with `.worktrees/`                                      |
| `ensureWorktreesIgnored` — already present | Does not duplicate the entry                                                 |

**File:** `src/main/__tests__/contextGenerator.test.ts` (new)

| Test                                                  | Description                                |
| ----------------------------------------------------- | ------------------------------------------ |
| Generates correct CONTEXT.md for task with all fields | Full golden-file comparison                |
| Handles missing description section                   | Renders "(no description provided)"        |
| Handles missing DoD section                           | Skips DoD section                          |
| Handles no linked decisions                           | Omits decisions section                    |
| Handles no milestone                                  | Omits milestone section                    |
| Handles missing decision file                         | Renders `> Note: Decision file not found.` |

### 10.2 Manual Testing Checklist

- [ ] Install `simple-git` if not present (`npm install simple-git`)
- [ ] Open a workspace that is a git repo with at least one commit
- [ ] Drag a backlog task to Doing
  - [ ] Card shows "Creating worktree…" loading state during IPC
  - [ ] Branch badge appears on card after creation: `⎇ feat/t-XXX-...`
  - [ ] `.worktrees/T-XXX/` directory exists in the repo
  - [ ] `git worktree list` in terminal shows the new worktree
  - [ ] `CONTEXT.md` exists in `.worktrees/T-XXX/` with correct content
  - [ ] Task frontmatter has `worktree` and `branch` fields set
  - [ ] Sidebar "WORKTREES" section shows the new worktree entry
  - [ ] Clicking the worktree row in sidebar navigates to the task
- [ ] Drag the same task to Doing again (idempotency)
  - [ ] No error, no duplicate worktree, silent success
- [ ] Drag a doing task to Done
  - [ ] Confirmation dialog appears with branch name and worktree path
  - [ ] Click "Keep worktree" → task does NOT move, dialog closes
  - [ ] Click "Remove worktree" → task moves to Done, `.worktrees/T-XXX/` is deleted
  - [ ] `git worktree list` no longer shows the removed worktree
  - [ ] Task frontmatter `worktree` and `branch` fields are cleared
  - [ ] Sidebar "WORKTREES" section no longer shows the entry
- [ ] Drag a doing task back to Backlog
  - [ ] Task moves without worktree prompt
  - [ ] Branch badge still appears on the backlog card
  - [ ] `.worktrees/T-XXX/` still exists
  - [ ] Sidebar "WORKTREES" section no longer shows it (filtered by `status === 'doing'`)
- [ ] Open a non-git workspace and drag a task to Doing
  - [ ] Task moves to Doing column
  - [ ] Toast: "This workspace is not a git repository. Worktree creation skipped."
  - [ ] No crash, no `worktree` field in frontmatter
- [ ] Verify `.worktrees/` is added to `.gitignore` on first creation
- [ ] Verify `CONTEXT.md` content matches the task's DoD, description, decisions, and milestone

### 10.3 Edge Case Verification

- [ ] Task with no body sections — CONTEXT.md renders gracefully
- [ ] Task with linked decisions where the decision file was deleted — CONTEXT.md notes the missing file
- [ ] Worktree directory manually deleted from filesystem — drag to Done proceeds silently
- [ ] Git not installed on PATH — toast error, no crash
- [ ] Repo with very long task title — branch name is capped at allowed length, no git error

---

## Part 11 — Implementation Order

Recommended sequence to minimize blocked work and allow incremental testing:

| Step | Description                                                                                                                                                        | Files                                      | Effort | Depends On    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------ | ------------- |
| 1    | Install `simple-git` if absent. Add `WorktreeInfo` type to `src/shared/types.ts`                                                                                   | `package.json`, `types.ts`                 | S      | —             |
| 2    | Create `src/main/git.ts`: `isGitRepo`, `listWorktrees`, `createWorktree`, `removeWorktree`, `deriveBranchName`, `detectBaseBranch`, `ensureWorktreesIgnored`       | `git.ts`                                   | L      | Step 1        |
| 3    | Move `parseTaskBody` / `serializeTaskBody` from `src/renderer/src/utils/taskBodyParser.ts` to `src/shared/taskBodyParser.ts`. Update the existing renderer import. | `taskBodyParser.ts`, `TaskDetailPanel.tsx` | S      | —             |
| 4    | Create `src/main/contextGenerator.ts`                                                                                                                              | `contextGenerator.ts`                      | M      | Steps 2, 3    |
| 5    | Create `src/main/ipc/git.ts` with `git:listWorktrees`, `git:createWorktree`, `git:removeWorktree`, `git:setupWorktreeForTask`, `git:teardownWorktreeForTask`       | `ipc/git.ts`                               | M      | Steps 2, 4    |
| 6    | Register git IPC handlers in `src/main/ipc/index.ts`                                                                                                               | `ipc/index.ts`                             | S      | Step 5        |
| 7    | Extend preload: `src/preload/index.ts` + `index.d.ts` with `git` namespace                                                                                         | `preload/index.ts`, `index.d.ts`           | S      | Step 5        |
| 8    | Create `useWorktreeStore.ts` and `useDialogStore.ts`                                                                                                               | new stores                                 | S      | —             |
| 9    | Create `ConfirmDialog.tsx` + `useDialogStore` integration. Create toast system (`useToastStore` + `Toast.tsx`).                                                    | new components                             | M      | Step 8        |
| 10   | Extend `Board.tsx` drag handler for `doing` and `done` cases. Wire `handleDragToDoing` and `handleDragToDone`.                                                     | `Board.tsx`                                | M      | Steps 7, 8, 9 |
| 11   | Add branch badge to `TaskCard.tsx`. Add worktree loading state.                                                                                                    | `TaskCard.tsx`, `TaskCard.module.css`      | S      | Step 8        |
| 12   | Create `WorktreeList.tsx` + styles. Wire into `Sidebar.tsx`.                                                                                                       | `WorktreeList.tsx`, `Sidebar.tsx`          | M      | —             |
| 13   | Write unit tests for `git.ts` and `contextGenerator.ts`                                                                                                            | `__tests__/`                               | M      | Steps 2, 4    |
| 14   | Manual end-to-end verification against the testing checklist                                                                                                       | —                                          | M      | Steps 1–12    |

**Size key:** S = <1 hour, M = 1–3 hours, L = 3–6 hours

**Total estimated effort:** ~20–28 hours

**Parallelizable:** Steps 3 and 8–9 have no dependencies on each other or on the git module and can be built alongside steps 2 and 5.

---

## Part 12 — File Manifest

### New files

| File                                                          | Purpose                                                                                                                                                                 |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/git.ts`                                             | All git operations: `isGitRepo`, `listWorktrees`, `createWorktree`, `removeWorktree`, `deriveBranchName`, `detectBaseBranch`, `ensureWorktreesIgnored`, `WorktreeError` |
| `src/main/contextGenerator.ts`                                | `generateContextFile()` — builds and writes `CONTEXT.md`                                                                                                                |
| `src/main/ipc/git.ts`                                         | IPC handlers: `git:listWorktrees`, `git:createWorktree`, `git:removeWorktree`, `git:setupWorktreeForTask`, `git:teardownWorktreeForTask`                                |
| `src/shared/taskBodyParser.ts`                                | `parseTaskBody` / `serializeTaskBody` moved from renderer utils (shared between main + renderer)                                                                        |
| `src/renderer/src/stores/useWorktreeStore.ts`                 | Transient worktree creation state (`creatingIds`)                                                                                                                       |
| `src/renderer/src/stores/useDialogStore.ts`                   | Imperative dialog state for `ConfirmDialog`                                                                                                                             |
| `src/renderer/src/components/shared/ConfirmDialog.tsx`        | Reusable confirmation modal                                                                                                                                             |
| `src/renderer/src/components/shared/ConfirmDialog.module.css` | Dialog styles                                                                                                                                                           |
| `src/renderer/src/components/shared/Toast.tsx`                | Toast notification stack                                                                                                                                                |
| `src/renderer/src/components/shared/Toast.module.css`         | Toast styles                                                                                                                                                            |
| `src/renderer/src/components/Sidebar/WorktreeList.tsx`        | Sidebar worktree section                                                                                                                                                |
| `src/renderer/src/components/Sidebar/WorktreeList.module.css` | Worktree list styles                                                                                                                                                    |
| `src/main/__tests__/git.test.ts`                              | Unit tests for `git.ts`                                                                                                                                                 |
| `src/main/__tests__/contextGenerator.test.ts`                 | Unit tests for `contextGenerator.ts`                                                                                                                                    |

### Existing files to modify

| File                                                     | Changes                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/shared/types.ts`                                    | Add `WorktreeInfo`, `WorktreeDisplayItem`                                |
| `src/main/ipc/index.ts`                                  | Register `registerGitHandlers()`                                         |
| `src/preload/index.ts`                                   | Add `git` namespace                                                      |
| `src/preload/index.d.ts`                                 | Add `git` type declarations, import `WorktreeInfo`                       |
| `src/renderer/src/components/Board/Board.tsx`            | Extend `onDragEnd` for Doing/Done worktree flows                         |
| `src/renderer/src/components/Board/TaskCard.tsx`         | Add branch badge row                                                     |
| `src/renderer/src/components/Board/TaskCard.module.css`  | Add `.branchRow`, `.branchIcon`, `.branchName`, `.branchCreating` styles |
| `src/renderer/src/components/Sidebar/Sidebar.tsx`        | Add `<WorktreeList>` section                                             |
| `src/renderer/src/components/Sidebar/Sidebar.module.css` | Add `.worktreeListArea` style                                            |
| `src/renderer/src/utils/taskBodyParser.ts`               | Delete file — contents moved to `src/shared/taskBodyParser.ts`           |
| `src/renderer/src/App.tsx`                               | Add toast renderer, clear `useWorktreeStore` on workspace switch         |
| `package.json`                                           | Add `simple-git` if not already present                                  |

### NPM dependencies

| Package      | Purpose                          | Install command          |
| ------------ | -------------------------------- | ------------------------ |
| `simple-git` | Git operations from main process | `npm install simple-git` |

Check `package.json` first — `simple-git` may already be present. No additional packages are required for Phase 5.

---

## Definition of Done

All of the following must be true:

1. Drag a task from Backlog to Doing in a git repo → `.worktrees/T-XXX/` is created → the task's `worktree` and `branch` frontmatter fields are set → `CONTEXT.md` exists at `.worktrees/T-XXX/CONTEXT.md` with the correct task title, DoD, context, decisions, and milestone
2. The branch badge `⎇ feat/t-XXX-...` appears on the Doing card within 2 seconds of the drag completing
3. The sidebar "WORKTREES" section appears and lists the active worktree with branch name and task ID
4. Dragging the same task to Doing a second time (idempotent) produces no error and no duplicate worktree
5. Drag a Doing task to Done → confirmation dialog appears with branch name → confirm → worktree directory removed → task `worktree` and `branch` fields cleared → branch still exists in git
6. Drag a Doing task back to Backlog → worktree is preserved → branch badge still appears on the backlog card
7. Dragging a task to Doing in a non-git workspace → task moves to Doing column → dismissible toast explains that worktree creation was skipped → no crash
8. `.worktrees/` is added to `.gitignore` automatically on first worktree creation
9. All unit tests in `git.test.ts` and `contextGenerator.test.ts` pass
10. No TypeScript errors in `tsc --noEmit`
11. App does not crash on any failure mode listed in the error handling matrix
