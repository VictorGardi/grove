---
id: T-004
title: Phase 5 — Git Worktree Automation
status: done
priority: high
created: 2026-04-03T00:00:00.000Z
tags:
  - git
  - worktrees
  - phase-5
  - electron
  - ipc
---

## Description

Implement git worktree lifecycle management integrated into the drag-and-drop kanban flow. Dragging a card to Doing creates an isolated git worktree and a CONTEXT.md for the agent. Dragging to Done prompts to remove the worktree (branch is kept).

## Definition of Done

- [x] Drag backlog task to Doing in a git repo → `.worktrees/T-XXX/` created → `worktree` + `branch` frontmatter set → `CONTEXT.md` present with correct task title, DoD, context, decisions, and milestone
- [x] Branch badge `⎇ feat/t-XXX-...` appears on card within 2 seconds
- [x] Sidebar "WORKTREES" section lists active worktrees with branch and task ID
- [x] Dragging same task to Doing again (idempotent) → no error, no duplicate worktree
- [x] Drag Doing task to Done → confirmation dialog shows branch name → confirm → worktree directory removed → `worktree` and `branch` fields cleared → branch still exists in git
- [x] Drag Doing task to Backlog → worktree preserved → branch badge remains on card
- [x] Drag task to Doing in non-git workspace → task moves → dismissible toast explains skip → no crash
- [x] `.worktrees/` auto-added to `.gitignore` on first worktree creation
- [x] All unit tests in `git.test.ts` and `contextGenerator.test.ts` pass
- [x] `tsc --noEmit` reports no errors
- [x] App does not crash on any failure mode in the error matrix

## Part 1 — Main Process: `src/main/git.ts` (new)

### Types — add to `src/shared/types.ts`

```ts
export interface WorktreeInfo {
  path: string; // absolute path
  head: string; // 40-char SHA
  branch: string | null; // "refs/heads/feat/T-004" or null if detached
  branchShort: string | null; // "feat/T-004"
  isMain: boolean;
  isBare: boolean;
  isDetached: boolean;
  terminalOpen: boolean; // always false in Phase 5; wired in Phase 6
}

export interface WorktreeDisplayItem {
  taskId: string;
  taskTitle: string;
  branch: string;
  worktreePath: string;
  terminalOpen: boolean;
}
```

### Error types

```ts
export type WorktreeErrorCode =
  | "NOT_A_REPO"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "BRANCH_LOCKED"
  | "DIRTY_WORKING_TREE"
  | "DETACHED_HEAD"
  | "EMPTY_REPO"
  | "GIT_NOT_FOUND"
  | "UNKNOWN";

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

### Function signatures

```ts
// Check if directory is a git repo (git rev-parse --is-inside-work-tree)
export async function isGitRepo(repoPath: string): Promise<boolean>;

// List worktrees (git worktree list --porcelain)
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]>;

// Create worktree — idempotent
// If .worktrees/<taskId> already exists and is a valid worktree → return existing path
// If branch exists locally → git worktree add .worktrees/<taskId> <branch> (no -b)
// If branch exists remotely only → git worktree add ... -b <branch> --track origin/<branch>
// If new → git worktree add .worktrees/<taskId> -b <branchName>
export async function createWorktree(
  repoPath: string,
  taskId: string,
  branchName: string,
): Promise<string>; // returns absolute worktree path

// Remove worktree — uses git.raw(['worktree', 'remove', '--force', absolutePath])
// --force needed for untracked files (e.g. CONTEXT.md)
// Does NOT delete the branch
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
): Promise<void>;

// HEAD branch → 'main' (if exists) → 'master' → null (empty repo)
export async function detectBaseBranch(
  repoPath: string,
): Promise<string | null>;
```

### Branch naming — `deriveBranchName`

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
// "T-004" + "JWT refresh token rotation" → "feat/t-004-jwt-refresh-token-rota"
```

### `.gitignore` guard — `ensureWorktreesIgnored`

After successful `git worktree add`, call this once per workspace:

```ts
async function ensureWorktreesIgnored(repoPath: string): Promise<void> {
  const gitignorePath = path.join(repoPath, ".gitignore");
  let content = "";
  try {
    content = await fs.promises.readFile(gitignorePath, "utf-8");
  } catch {}
  if (content.includes(".worktrees/")) return;
  const append = content.endsWith("\n") ? ".worktrees/\n" : "\n.worktrees/\n";
  await fs.promises.appendFile(gitignorePath, append, "utf-8");
}
```

---

## Part 2 — Main Process: `src/main/contextGenerator.ts` (new)

**Move `parseTaskBody` / `serializeTaskBody` from `src/renderer/src/utils/taskBodyParser.ts` → `src/shared/taskBodyParser.ts`** so both main and renderer can import it. Update existing renderer imports.

### Interface

```ts
export interface DecisionContent {
  id: string;
  title: string;
  body: string;
}

export async function generateContextFile(
  worktreePath: string,
  task: TaskInfo,
  taskBody: string,
  decisions: DecisionContent[],
  milestone: MilestoneInfo | null,
): Promise<void>;
```

### CONTEXT.md template

```markdown
# Task Context: <task.title>

> Generated by Grove on <ISO date>. Do not edit — regenerated on each worktree creation.

## Task

**ID:** <task.id>
**Branch:** <task.branch>
**Priority:** <task.priority | 'not set'>
**Agent:** <task.agent | 'not set'>

## Milestone: <milestone.title> ← omit if no milestone

**ID:** <milestone.id>

<milestone description body>

## Linked Decisions ← omit if decisions array empty

### <decision.id>: <decision.title>

<full decision body>

---
```

If a decision file is not found: render `> Note: Decision file not found.`

Write using existing `atomicWrite` utility: `await atomicWrite(path.join(worktreePath, 'CONTEXT.md'), content)`

---

## Part 3 — IPC Handlers: `src/main/ipc/git.ts` (new)

### Channels

| Channel                       | Input                          | Output                                    |
| ----------------------------- | ------------------------------ | ----------------------------------------- |
| `git:listWorktrees`           | `repoPath: string`             | `IpcResult<WorktreeInfo[]>`               |
| `git:createWorktree`          | `repoPath, taskId, branchName` | `IpcResult<{ worktreePath, branchName }>` |
| `git:removeWorktree`          | `repoPath, worktreePath`       | `IpcResult<void>`                         |
| `git:setupWorktreeForTask`    | `SetupWorktreeInput`           | `IpcResult<SetupWorktreeResult>`          |
| `git:teardownWorktreeForTask` | `TeardownWorktreeInput`        | `IpcResult<void>`                         |

### Orchestrating channels

**`git:setupWorktreeForTask`** — single call, runs full sequence in main process:

```ts
interface SetupWorktreeInput {
  workspacePath: string;
  taskFilePath: string; // absolute path to .md (already in .tasks/doing/)
  taskId: string;
  taskTitle: string;
}
interface SetupWorktreeResult {
  worktreePath: string; // relative, e.g. ".worktrees/T-004"
  branchName: string;
  alreadyExisted: boolean;
}
```

Sequence:

1. Derive `branchName` from `(taskId, taskTitle)`
2. Check if `.worktrees/<taskId>` exists and is valid → if so, return `alreadyExisted: true`
3. Call `createWorktree(workspacePath, taskId, branchName)`
4. Read task body from `taskFilePath`
5. Read linked decision files from `workspacePath/.decisions/`
6. Read linked milestone file if `task.milestone` is set
7. Call `generateContextFile(worktreePath, task, body, decisions, milestone)`
8. Call `updateTask(workspacePath, taskFilePath, { worktree: '.worktrees/<taskId>', branch: branchName })`
9. Return `{ worktreePath, branchName, alreadyExisted: false }`

**`git:teardownWorktreeForTask`** — sequence:

```ts
interface TeardownWorktreeInput {
  workspacePath: string;
  taskFilePath: string; // absolute path (already in .tasks/done/)
  worktreePath: string; // relative or absolute from frontmatter
}
```

1. Resolve absolute path
2. If directory doesn't exist → skip silently
3. Call `removeWorktree(workspacePath, absolutePath)` — on `DIRTY_WORKING_TREE` error: return `{ ok: false, error: '...' }`
4. Call `updateTask(workspacePath, taskFilePath, { worktree: null, branch: null })`
5. Return `{ ok: true }`

**Register in `src/main/ipc/index.ts`:** add `registerGitHandlers()` call.

---

## Part 4 — Preload Extension

### `src/preload/index.ts`

```ts
git: {
  listWorktrees: (repoPath: string) =>
    ipcRenderer.invoke('git:listWorktrees', repoPath),
  setupWorktreeForTask: (input: SetupWorktreeInput) =>
    ipcRenderer.invoke('git:setupWorktreeForTask', input),
  teardownWorktreeForTask: (input: TeardownWorktreeInput) =>
    ipcRenderer.invoke('git:teardownWorktreeForTask', input),
},
```

### `src/preload/index.d.ts`

Add matching type declarations. Import `WorktreeInfo` from `@shared/types`.

---

## Part 5 — Renderer: Drag Flow (Board.tsx)

### `handleDragToDoing`

Called after `task:move` succeeds and `toStatus === 'doing'`:

```ts
async function handleDragToDoing(task: TaskInfo): Promise<void> {
  useWorktreeStore.getState().markCreating(task.id);

  const result = await window.api.git.setupWorktreeForTask({
    workspacePath: wp,
    taskFilePath: task.filePath,
    taskId: task.id,
    taskTitle: task.title,
  });

  useWorktreeStore.getState().markCreated(task.id);

  if (!result.ok) {
    showWorktreeError(result.error); // maps error code → user message
    return;
  }

  // Patch in-memory state immediately (don't wait for chokidar)
  useDataStore.getState().patchTask({
    ...task,
    worktree: result.data.worktreePath,
    branch: result.data.branchName,
  });

  if (!result.data.alreadyExisted)
    showToast(`Worktree created: ${result.data.branchName}`, "success");
}
```

**Important:** `task:move` runs first, then `git:setupWorktreeForTask`. The move happens before worktree setup.

### `handleDragToDone`

Called when `toStatus === 'done' && task.worktree`:

```ts
async function handleDragToDone(task: TaskInfo): Promise<void> {
  const confirmed = await showWorktreeRemovalDialog(task);
  if (!confirmed) return; // do not move task

  // Move to done (optimistic)
  useDataStore.getState().patchTask({ ...task, status: "done" });
  const moveOk = await moveTask(task.filePath, "done");
  if (!moveOk) {
    useDataStore.getState().patchTask(task); // rollback
    showToast("Failed to move task to Done", "error");
    return;
  }

  const movedTask = useDataStore.getState().tasks.find((t) => t.id === task.id);
  const result = await window.api.git.teardownWorktreeForTask({
    workspacePath: wp,
    taskFilePath: movedTask!.filePath,
    worktreePath: task.worktree!,
  });

  if (!result.ok) {
    // Non-blocking: task already moved, just warn about worktree
    showToast(
      `Task done, but worktree removal failed: ${result.error}`,
      "warning",
    );
    return;
  }

  useDataStore
    .getState()
    .patchTask({ ...movedTask!, worktree: null, branch: null });
  showToast("Task done. Worktree removed. Branch kept.", "success");
}
```

### Confirmation dialog content

```
Title:   Remove worktree?
Message: The branch "feat/t-004-..." will be kept.
         The working tree at .worktrees/T-004 will be deleted.
Confirm: Remove worktree
Cancel:  Keep worktree
```

**Do NOT use `window.confirm()`** — it freezes Electron. Use a React portal modal via `useDialogStore`.

---

## Part 6 — New Renderer Stores

### `src/renderer/src/stores/useWorktreeStore.ts`

```ts
interface WorktreeState {
  creatingIds: Set<string>; // task IDs currently creating a worktree
  markCreating: (taskId: string) => void;
  markCreated: (taskId: string) => void;
  clear: () => void; // called on workspace switch
}
```

In `App.tsx`: call `useWorktreeStore.getState().clear()` on workspace switch.

### `src/renderer/src/stores/useDialogStore.ts`

Imperative dialog system — `show(options)` returns `Promise<boolean>`. Used by `showWorktreeRemovalDialog()`.

### Toast system

Add `useToastStore` + `Toast.tsx` component. Toasts auto-dismiss after 5 seconds. Variants: `success` (green), `warning` (amber), `error` (red). Render in `App.tsx` root.

---

## Part 7 — TaskCard Branch Badge

### `src/renderer/src/components/Board/TaskCard.tsx`

```tsx
const worktreeCreating = useWorktreeStore((s) => s.creatingIds.has(task.id));

{
  /* Branch row — shown when worktree is active */
}
{
  worktreeCreating && (
    <div className={styles.branchRow}>
      <span className={styles.branchCreating}>Creating worktree…</span>
    </div>
  );
}
{
  !worktreeCreating && task.branch && (
    <div className={styles.branchRow}>
      <span className={styles.branchIcon}>⎇</span>
      <span className={styles.branchName}>{task.branch}</span>
    </div>
  );
}
```

Position: between title row and description preview.

CSS: mono font 11px, `--text-secondary`, ellipsis truncation at `max-width: 180px`.

---

## Part 8 — Sidebar Worktree Section

### `src/renderer/src/components/Sidebar/WorktreeList.tsx` (new)

Data source — derived selector (no extra IPC):

```ts
export const useActiveWorktrees = (): WorktreeDisplayItem[] =>
  useDataStore((s) =>
    s.tasks
      .filter((t) => t.status === "doing" && t.worktree !== null)
      .map((t) => ({
        taskId: t.id,
        taskTitle: t.title,
        branch: t.branch ?? "(unknown branch)",
        worktreePath: t.worktree!,
        terminalOpen: false, // Phase 6 wires this
      })),
  );
```

Layout:

```
WORKTREES
  ⎇ feat/t-004-jwt-refresh
    T-004 · JWT refresh tok…
    ● idle
```

- Section label: uppercase `--text-lo`, same style as "WORKSPACES"
- Branch line: `⎇` + branch in mono 12px `--text-secondary`
- Task line: ID in mono 11px `--text-lo` + `·` + title truncated
- Status: `●` dot gray for idle
- Hover: `--bg-hover`
- Click: navigate to board + select task
- Only render section if `worktrees.length > 0`

Add to `Sidebar.tsx` between workspace list and bottom nav.

---

## Part 9 — Error Handling Matrix

| Scenario                           | Code                 | User Message                                                                      | Rollback task move?                            |
| ---------------------------------- | -------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| Not a git repo                     | `NOT_A_REPO`         | "This workspace is not a git repository. Worktree creation skipped."              | No — task stays in Doing                       |
| git not on PATH                    | `GIT_NOT_FOUND`      | "git not found. Install git and restart Grove."                                   | No                                             |
| Repo has no commits                | `EMPTY_REPO`         | "Cannot create worktree: repository has no commits yet."                          | No                                             |
| Branch checked out elsewhere       | `BRANCH_LOCKED`      | "Branch already open in another worktree. Close it first."                        | Yes — rollback to source status                |
| Worktree dir exists but invalid    | `ALREADY_EXISTS`     | "Worktree directory exists but is not valid. Remove `.worktrees/T-XXX` manually." | No                                             |
| Detached HEAD                      | `DETACHED_HEAD`      | "Repository is in detached HEAD state. Checkout a branch first."                  | No                                             |
| Disk full / permission             | `UNKNOWN`            | "Failed to create worktree: [message]"                                            | Yes — rollback                                 |
| `task:move` fails                  | —                    | "Failed to move task: [message]"                                                  | N/A — worktree untouched                       |
| `CONTEXT.md` write fails           | —                    | Warning toast only; worktree still created                                        | No                                             |
| `task:update` fails after worktree | —                    | Warning: "Worktree created but frontmatter could not be updated."                 | No                                             |
| Remove fails — dirty tracked files | `DIRTY_WORKING_TREE` | "Worktree has uncommitted changes. Commit or stash, then remove manually."        | Task stays in Done; worktree field NOT cleared |
| Remove — worktree already gone     | —                    | Silent success                                                                    | N/A                                            |
| Worktree locked by git             | `BRANCH_LOCKED`      | "Worktree is locked. Run `git worktree unlock <path>` in terminal."               | No                                             |

---

## Part 10 — Edge Cases

- **Detached HEAD:** `git rev-parse --abbrev-ref HEAD` returns `HEAD` literally → throw `DETACHED_HEAD` before attempting worktree add
- **Dirty working tree at creation:** Not an error — `git worktree add` is branch-based, not state-based
- **Dirty working tree at removal:** `git worktree remove --force` handles untracked files but refuses committed dirty files → surface `DIRTY_WORKING_TREE` error
- **Locked worktrees:** Parse `locked` line in `git worktree list --porcelain` output
- **Back to Backlog from Doing:** Preserve worktree + branch fields; show branch badge on backlog card; sidebar hides entry (filtered by `status === 'doing'`)
- **Backlog → Done (never via Doing):** `task.worktree` is null → skip prompt; normal move
- **Multiple rapid drags:** Each targets different `.worktrees/T-XXX` directory → no conflict
- **Workspace switch during in-flight creation:** `useWorktreeStore.clear()` on switch; in-flight `patchTask` will no-op (store cleared)
- **Repo without remote:** No error — branch naming and worktree creation work without remote
- **`.worktrees/` in gitignore:** Auto-append on first creation via `ensureWorktreesIgnored()`

---

## Part 11 — New Files

| File                                                   | Purpose                                                                                                                                             |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/git.ts`                                      | `isGitRepo`, `listWorktrees`, `createWorktree`, `removeWorktree`, `deriveBranchName`, `detectBaseBranch`, `ensureWorktreesIgnored`, `WorktreeError` |
| `src/main/contextGenerator.ts`                         | `generateContextFile()`                                                                                                                             |
| `src/main/ipc/git.ts`                                  | 5 IPC handlers                                                                                                                                      |
| `src/shared/taskBodyParser.ts`                         | Moved from renderer utils                                                                                                                           |
| `src/renderer/src/stores/useWorktreeStore.ts`          | Transient creation state                                                                                                                            |
| `src/renderer/src/stores/useDialogStore.ts`            | Imperative modal system                                                                                                                             |
| `src/renderer/src/components/shared/ConfirmDialog.tsx` | Reusable confirm modal                                                                                                                              |
| `src/renderer/src/components/shared/Toast.tsx`         | Toast notification stack                                                                                                                            |
| `src/renderer/src/components/Sidebar/WorktreeList.tsx` | Sidebar worktree section                                                                                                                            |
| `src/main/__tests__/git.test.ts`                       | Unit tests                                                                                                                                          |
| `src/main/__tests__/contextGenerator.test.ts`          | Unit tests                                                                                                                                          |

## Modified Files

| File                                              | Changes                                                  |
| ------------------------------------------------- | -------------------------------------------------------- |
| `src/shared/types.ts`                             | Add `WorktreeInfo`, `WorktreeDisplayItem`                |
| `src/main/ipc/index.ts`                           | Register `registerGitHandlers()`                         |
| `src/preload/index.ts` + `index.d.ts`             | Add `git` namespace                                      |
| `src/renderer/src/components/Board/Board.tsx`     | Extend `onDragEnd` for Doing/Done                        |
| `src/renderer/src/components/Board/TaskCard.tsx`  | Branch badge + loading state                             |
| `src/renderer/src/components/Sidebar/Sidebar.tsx` | Add `<WorktreeList>`                                     |
| `src/renderer/src/App.tsx`                        | Toast renderer, clear worktree store on workspace switch |
| `src/renderer/src/utils/taskBodyParser.ts`        | Delete — moved to shared                                 |
| `package.json`                                    | Add `simple-git` if absent                               |

---

## Part 12 — Implementation Order

| Step | Task                                                   | Files                            | Est. |
| ---- | ------------------------------------------------------ | -------------------------------- | ---- |
| 1    | Install `simple-git`; add `WorktreeInfo` type          | `package.json`, `types.ts`       | S    |
| 2    | Create `src/main/git.ts` with all functions            | `git.ts`                         | L    |
| 3    | Move `parseTaskBody` to `src/shared/taskBodyParser.ts` | `taskBodyParser.ts`              | S    |
| 4    | Create `src/main/contextGenerator.ts`                  | `contextGenerator.ts`            | M    |
| 5    | Create `src/main/ipc/git.ts` with all 5 handlers       | `ipc/git.ts`                     | M    |
| 6    | Register git IPC in `ipc/index.ts`                     | `ipc/index.ts`                   | S    |
| 7    | Extend preload                                         | `preload/index.ts`, `index.d.ts` | S    |
| 8    | Create `useWorktreeStore`, `useDialogStore`            | new stores                       | S    |
| 9    | Create `ConfirmDialog`, toast system                   | new components                   | M    |
| 10   | Extend `Board.tsx` drag handler                        | `Board.tsx`                      | M    |
| 11   | Branch badge in `TaskCard.tsx`                         | `TaskCard.tsx`, CSS              | S    |
| 12   | Create `WorktreeList.tsx`; wire into `Sidebar.tsx`     | new component                    | M    |
| 13   | Unit tests for `git.ts` + `contextGenerator.ts`        | `__tests__/`                     | M    |
| 14   | End-to-end manual verification                         | —                                | M    |

**Size key:** S = <1h, M = 1–3h, L = 3–6h | **Total: ~20–28h**

Steps 3 and 8–9 can be worked in parallel with steps 2 and 5.

---

## Context for agent

See VISION.md Phase 5 spec for canonical goals. This task file contains the full senior-reviewed implementation plan. Follow Part 11 Implementation Order. Key patterns to follow from existing code:

- All git/fs ops in main process — never from renderer
- IPC via `contextBridge` — see existing handlers in `src/main/ipc/`
- Atomic file writes: write to `<file>.tmp` then rename
- Debounce writes 300ms; use in-memory state as truth after write
- CSS modules + CSS variables — no inline styles, no CSS-in-JS
- Zustand stores: lean, no boilerplate — see existing store patterns
