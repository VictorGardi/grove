# Plan: Align TaskCentricView with Board Execution Flow

## Problem

TaskCentricView and Board handle task execution differently, causing inconsistent behavior:

| Aspect            | Board                                                                     | TaskCentricView                                                         |
| ----------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Context injection | Board creates session + injects context immediately in one flow           | TaskTerminal mount effect handles injection                             |
| Flag management   | Sets `terminalExecContextSent: false` before injection, then `true` after | Resets to `false` on move to doing but relies on TaskTerminal to manage |
| Timing            | Injection happens synchronously after session creation                    | Injection happens async after mount (race conditions)                   |

## Solution

Move the execution flow from TaskTerminal's mount effect into TaskCentricView, mirroring exactly how Board.tsx works.

---

## Step 1: Extract injection logic from TaskTerminal

**File:** `src/renderer/src/components/TaskDetail/TaskTerminal.tsx`

Extract the injection logic into a reusable function that can be called by both Board and TaskCentricView.

```typescript
// Export this function from TaskTerminal.tsx
export async function injectExecutionContext(params: {
  sessionName: string;
  ptyId: string;
  task: TaskInfo;
  workspacePath: string;
  taskContent: string;
  promptConfig: PromptConfig;
}): Promise<void> {
  // ... implementation (move from Board.tsx)
}
```

This function already exists in Board.tsx (lines 443-507) - we can move it to TaskTerminal.tsx and reuse it.

---

## Step 2: Create `handleDragToDoing` in TaskCentricView

**File:** `src/renderer/src/components/TaskCentric/TaskCentricView.tsx`

Replace the current `handleStartExecution` with a `handleDragToDoing` that mirrors Board.tsx's flow:

```typescript
const handleDragToDoing = useCallback(async () => {
  if (!selectedTask || !activeWorkspacePath) return;

  const { updateTask: doUpdateTask, moveTask: doMoveTask } =
    await import("../../actions/taskActions");

  // 1. Move task to doing
  await doMoveTask(selectedTask.filePath, "doing");

  // 2. Re-fetch the moved task (path may have changed)
  const movedTask =
    useDataStore.getState().tasks.find((t) => t.id === selectedTask.id) ??
    selectedTask;

  // 3. Kill any existing exec session
  if (movedTask.terminalExecSession) {
    const execPtyId = `taskterm-exec-${selectedTask.id}`;
    await window.api.taskterm.kill({
      ptyId: execPtyId,
      sessionName: movedTask.terminalExecSession,
    });
  }

  // 4. Read task content
  const rawResult = await window.api.tasks.readRaw(
    activeWorkspacePath,
    movedTask.filePath,
  );

  // 5. Create new session
  const cwd =
    selectedTask.useWorktree && selectedTask.worktree
      ? selectedTask.worktree.startsWith("/")
        ? selectedTask.worktree
        : `${activeWorkspacePath}/${selectedTask.worktree}`
      : activeWorkspacePath;

  const createResult = await window.api.taskterm.create({
    ptyId: `taskterm-exec-${selectedTask.id}`,
    taskId: selectedTask.id,
    agent:
      selectedTask.agent ??
      activeWorkspaceDefaults.defaultExecutionAgent ??
      "opencode",
    model: activeWorkspaceDefaults.defaultExecutionModel ?? null,
    cwd,
    sessionMode: "exec",
    taskFilePath: movedTask.filePath,
    workspacePath: activeWorkspacePath,
  });

  if (!createResult.ok) {
    showToast(`Execution failed to start: ${createResult.error}`, "error");
    return;
  }

  // 6. Mark context as NOT sent (fresh session)
  await doUpdateTask(movedTask.filePath, { terminalExecContextSent: false });

  // 7. Inject context immediately
  const sessionName = createResult.sessionName;
  if (sessionName) {
    await injectExecutionContext({
      sessionName,
      ptyId: `taskterm-exec-${selectedTask.id}`,
      task: movedTask,
      workspacePath: activeWorkspacePath,
      taskContent:
        rawResult.data ??
        `# ${movedTask.title}\n\n${movedTask.description ?? ""}`,
    });

    // 8. Mark context as sent
    await doUpdateTask(movedTask.filePath, { terminalExecContextSent: true });
  }
}, [selectedTask, activeWorkspacePath, activeWorkspaceDefaults]);
```

---

## Step 3: Update TaskTerminal to NOT handle injection on mount

**File:** `src/renderer/src/components/TaskDetail/TaskTerminal.tsx`

Simplify the mount effect to only handle reconnection, not injection:

```typescript
useEffect(() => {
  // ... existing data/exit subscriptions ...

  const existing = initialSessionName;

  if (existing && sessionMode === "exec") {
    // Only reconnect - no injection
    void (async () => {
      const fresh = await readFreshFrontmatter(task.filePath);

      if (fresh === null) {
        setSessionState("none");
        return;
      }

      // Validate session is alive
      const storedSession = fresh.terminalExecSession;
      let sessionToReconnect = existing;
      if (storedSession) {
        const isStoredSessionAlive =
          await window.api.taskterm.isAlive(storedSession);
        if (isStoredSessionAlive) {
          sessionToReconnect = storedSession;
        }
      }

      // Set contextSentRef based on fresh frontmatter
      contextSentRef.current = fresh.terminalExecContextSent === true;
      reconnectSession(sessionToReconnect);
    })();
  } else if (existing) {
    // Non-exec mode - just reconnect
    reconnectSession(existing);
  } else if (sessionMode === "exec") {
    // This should rarely happen now - injection is handled externally
    setTimeout(() => startNewSession(), 300);
  }

  return () => {
    unsubData();
    unsubExit();
  };
}, []);
```

---

## Step 4: Update TaskCentricView rendering

**File:** `src/renderer/src/components/TaskCentric/TaskCentricView.tsx`

The `<TaskTerminal>` component should still receive the task for display, but:

1. Remove the logic that resets `terminalExecContextSent: false` on execution start
2. Let TaskTerminal just display the running session

Currently at line 135-144:

```typescript
// DELETE THIS - injection should happen in handleDragToDoing now
if (movedTask.terminalExecSession) {
  const execPtyId = `taskterm-exec-${selectedTask.id}`;
  await window.api.taskterm.kill({...});
  await doUpdateTask(movedTask.filePath, {
    terminalExecContextSent: false,  // Remove - handled by injectExecutionContext
  });
}
```

---

## Step 5: Remove duplicate injection code from Board.tsx

**File:** `src/renderer/src/components/Board/Board.tsx`

Once `injectExecutionContext` is moved to TaskTerminal.tsx and exported, Board can import it:

```typescript
import { injectExecutionContext } from "../TaskDetail/TaskTerminal";
```

Then delete the local `injectExecutionContext` function (lines 443-507).

---

## Step 6: Add status change UI to TaskDetailPanel

**File:** `src/renderer/src/components/TaskDetail/TaskDetailPanel.tsx`

Currently the status is displayed as a read-only tag (lines 528-534). Add a dropdown or button group to change status.

```typescript
// Add near the status display area
const handleStatusChange = useCallback(async (newStatus: TaskStatus) => {
  if (!task) return;

  if (newStatus === "doing") {
    // Trigger execution flow (same as handleDragToDoing)
    await handleDragToDoing(task);
  } else {
    // Just move the task
    await moveTask(task.filePath, newStatus);
  }
}, [task, activeWorkspacePath]);

// Replace the status display with:
<div className={styles.statusTag}>
  <select
    value={task.status}
    onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
    className={styles.statusSelect}
  >
    <option value="backlog">Backlog</option>
    <option value="doing">Doing</option>
    <option value="review">Review</option>
    <option value="done">Done</option>
  </select>
</div>
```

**Style considerations:**

- The select should look like the current tag (with colored dot)
- Or use a button group that's consistent with the Board view
- Handle status transitions properly (e.g., confirm before moving to done if worktree exists)

---

## Step 7: Add status change UI to TaskCentricView

**File:** `src/renderer/src/components/TaskCentric/TaskCentricView.tsx`

Currently shows "Start Execution" button for backlog tasks (line 164-171). Replace with a status dropdown/buttons.

```typescript
// In the centerColumnHeader, replace the "Start Execution" button with:
<div className={styles.statusControls}>
  <select
    value={selectedTask.status}
    onChange={(e) => {
      const newStatus = e.target.value as TaskStatus;
      if (newStatus === "doing") {
        handleDragToDoing();
      } else {
        moveTask(selectedTask.filePath, newStatus);
      }
    }}
    className={styles.statusSelect}
  >
    <option value="backlog">Backlog</option>
    <option value="doing">Doing</option>
    <option value="review">Review</option>
    <option value="done">Done</option>
  </select>
</div>
```

Also remove the current `handleStartExecution` function since it's replaced by the unified flow.

---

## Summary of Changes

| File                  | Change                                                    |
| --------------------- | --------------------------------------------------------- |
| `TaskTerminal.tsx`    | Export `injectExecutionContext` function                  |
| `TaskTerminal.tsx`    | Simplify mount effect to only reconnect                   |
| `TaskCentricView.tsx` | Create `handleDragToDoing` that mirrors Board.tsx flow    |
| `TaskCentricView.tsx` | Remove the reset of `terminalExecContextSent: false`      |
| `TaskCentricView.tsx` | Add status dropdown/buttons to change task status         |
| `Board.tsx`           | Import and use `injectExecutionContext` from TaskTerminal |
| `TaskDetailPanel.tsx` | Add status dropdown/buttons to change task status         |

This ensures both views use the exact same execution flow:

1. Move task to doing
2. Create session
3. Inject context immediately
4. Mark `terminalExecContextSent: true`

And both views have consistent UI for changing task status.
