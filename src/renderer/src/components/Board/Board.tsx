import { useState, useCallback, useEffect, useMemo } from "react";
import Fuse from "fuse.js";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useDataStore } from "../../stores/useDataStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useWorktreeStore } from "../../stores/useWorktreeStore";
import { useDialogStore } from "../../stores/useDialogStore";
import { useBoardStore } from "../../stores/useBoardStore";
import { usePlanStore } from "../../stores/usePlanStore";
import { showToast } from "../../stores/useToastStore";
import type { TaskInfo, TaskStatus } from "@shared/types";
import { moveTask, updateTask } from "../../actions/taskActions";
import { buildFirstExecutionMessage } from "../../utils/planPrompts";
import { Column } from "./Column";
import { BoardToolbar } from "./BoardToolbar";
import { TaskCard } from "./TaskCard";
import styles from "./Board.module.css";

const COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: "backlog", label: "BACKLOG", color: "var(--text-lo)" },
  { status: "doing", label: "DOING", color: "var(--status-green)" },
  { status: "review", label: "REVIEW", color: "var(--status-amber)" },
  { status: "done", label: "DONE", color: "var(--status-green)" },
];

const VALID_STATUSES = new Set<string>(["backlog", "doing", "review", "done"]);

/** Map WorktreeError codes to user-friendly messages */
function worktreeErrorMessage(error: string): string {
  if (error.includes("[NOT_A_REPO]"))
    return "This workspace is not a git repository. Worktree creation skipped.";
  if (error.includes("[GIT_NOT_FOUND]"))
    return "git not found. Install git and restart Grove.";
  if (error.includes("[EMPTY_REPO]"))
    return "Cannot create worktree: repository has no commits yet.";
  if (error.includes("[BRANCH_LOCKED]"))
    return "Branch already open in another worktree. Close it first.";
  if (error.includes("[ALREADY_EXISTS]"))
    return "Worktree directory exists but is not valid. Remove .worktrees/ manually.";
  if (error.includes("[DETACHED_HEAD]"))
    return "Repository is in detached HEAD state. Checkout a branch first.";
  return `Failed to create worktree: ${error}`;
}

/** Codes that should NOT roll back the task move to Doing */
const NOROLLBACK_CODES = new Set([
  "NOT_A_REPO",
  "GIT_NOT_FOUND",
  "EMPTY_REPO",
  "ALREADY_EXISTS",
  "DETACHED_HEAD",
]);

function shouldRollback(error: string): boolean {
  for (const code of NOROLLBACK_CODES) {
    if (error.includes(`[${code}]`)) return false;
  }
  return true;
}

export function Board(): React.JSX.Element {
  const tasks = useDataStore((s) => s.tasks);
  const loading = useDataStore((s) => s.loading);
  const [activeTask, setActiveTask] = useState<TaskInfo | null>(null);

  const searchQuery = useBoardStore((s) => s.searchQuery);

  // Clear search when leaving board view (handled via useEffect in parent,
  // but we also handle it here when component unmounts)
  useEffect(() => {
    return () => {
      useBoardStore.getState().clearSearch();
    };
  }, []);

  // Fuse.js instance, rebuilt when tasks change
  const fuse = useMemo(
    () =>
      new Fuse(tasks, {
        keys: ["title", "description", "tags", "id"],
        threshold: 0.35,
        includeScore: true,
      }),
    [tasks],
  );

  // Compute search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return fuse.search(searchQuery);
  }, [fuse, searchQuery]);

  // Set of matched task IDs (in ranked order)
  const matchedIds: string[] | null = useMemo(() => {
    if (!searchResults) return null;
    return searchResults.map((r) => r.item.id);
  }, [searchResults]);

  const matchCount = matchedIds?.length ?? 0;

  // Handle Enter from board search: open top-ranked match
  useEffect(() => {
    function handleBoardSearchEnter(): void {
      if (!matchedIds || matchedIds.length === 0) return;
      const topId = matchedIds[0];
      useDataStore.getState().setSelectedTask(topId);
      useBoardStore.getState().clearSearch();
    }

    document.addEventListener("board-search-enter", handleBoardSearchEnter);
    return () =>
      document.removeEventListener(
        "board-search-enter",
        handleBoardSearchEnter,
      );
  }, [matchedIds]);

  // Pointer sensor with activation distance to avoid accidental drags on click
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // When search is active, filter displayed tasks; otherwise show all
  const filtered = searchResults ? searchResults.map((r) => r.item) : tasks;

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id);
      setActiveTask(task ?? null);
    },
    [tasks],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTask(null);
      const { active, over } = event;
      if (!over) return;

      const task = tasks.find((t) => t.id === active.id);
      if (!task) return;

      const toStatus = String(over.id);
      if (!VALID_STATUSES.has(toStatus)) return;
      if (task.status === toStatus) return;

      // Async path for Doing and Done (with worktree)
      if (toStatus === "doing") {
        void handleDragToDoing(task);
        return;
      }

      if (toStatus === "done" && task.worktree) {
        void handleDragToDone(task);
        return;
      }

      // Default: plain move (backlog, review, or done without worktree)
      moveTask(task.filePath, toStatus as TaskStatus);
    },
    [tasks],
  );

  const handleDragCancel = useCallback(() => {
    setActiveTask(null);
  }, []);

  if (loading && tasks.length === 0) {
    return (
      <div className={styles.board}>
        <div className={styles.loading}>Loading tasks...</div>
      </div>
    );
  }

  if (!loading && tasks.length === 0) {
    return (
      <div className={styles.board}>
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>No tasks yet</div>
          <div className={styles.emptyHint}>
            Create a Markdown file in .tasks/backlog/ to get started
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.board}>
      <BoardToolbar matchCount={searchQuery.trim() ? matchCount : undefined} />
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className={styles.columns}>
          {COLUMNS.map((col) => {
            let colTasks = filtered.filter((t) => t.status === col.status);
            if (col.status === "done") {
              colTasks = [...colTasks].sort((a, b) => {
                const dateA = a.completed ?? a.created ?? "";
                const dateB = b.completed ?? b.created ?? "";
                return dateB.localeCompare(dateA);
              });
            }
            return (
              <Column
                key={col.status}
                status={col.status}
                label={col.label}
                color={col.color}
                tasks={colTasks}
                matchedIds={matchedIds}
              />
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div className={styles.dragOverlay}>
              <TaskCard task={activeTask} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// ── Worktree drag handlers (module-level async, not hooks) ────────────────────

async function handleDragToDoing(task: TaskInfo): Promise<void> {
  const wp = useWorkspaceStore.getState().activeWorkspacePath;
  if (!wp) return;

  // Move to Doing first
  const moveOk = await moveTask(task.filePath, "doing");
  if (!moveOk) {
    showToast(`Failed to move task: ${task.title}`, "error");
    return;
  }

  // Get updated task (filePath may have changed after move)
  let movedTask =
    useDataStore.getState().tasks.find((t) => t.id === task.id) ?? task;

  // Clear stale exec session fields so a fresh session is started
  // (not a resume attempt) — especially important when re-dragging
  // from backlog back to doing.
  if (movedTask.execSessionId || movedTask.execTmuxSession) {
    // Cancel any orphaned background process before clearing the session
    if (movedTask.execTmuxSession) {
      await window.api.plan.cancel({
        taskId: task.id,
        mode: "execute",
        workspacePath: wp,
        taskFilePath: movedTask.filePath,
      });
    }
    // Clear in-memory plan store session so a fresh slot is created
    usePlanStore.getState().clearSession(`execute:${task.id}`);
    await updateTask(movedTask.filePath, {
      execSessionId: null,
      execTmuxSession: null,
    });
    // Re-read task after update to get fresh filePath / metadata
    movedTask =
      useDataStore.getState().tasks.find((t) => t.id === task.id) ?? movedTask;
  }

  // Resolve worktree path (absolute) for plan.send
  let worktreeAbsPath: string | undefined;

  if (movedTask.useWorktree !== false) {
    // ── Worktree mode (default) ──────────────────────────────────
    // Create an isolated git worktree so the execute agent works on its own branch.
    useWorktreeStore.getState().markCreating(task.id);

    const result = await window.api.git.setupWorktreeForTask({
      workspacePath: wp,
      taskFilePath: movedTask.filePath,
      taskId: task.id,
      taskTitle: task.title,
    });

    useWorktreeStore.getState().markCreated(task.id);

    if (!result.ok) {
      if (shouldRollback(result.error)) {
        await moveTask(movedTask.filePath, task.status);
      }
      showToast(worktreeErrorMessage(result.error), "error");
      return;
    }

    useDataStore.getState().patchTask({
      ...movedTask,
      status: "doing",
      worktree: result.data.worktreePath,
      branch: result.data.branchName,
    });

    if (!result.data.alreadyExisted) {
      showToast(`Worktree created: ${result.data.branchName}`, "success");
    }

    // Resolve worktree path to absolute for plan.send
    const wtp = result.data.worktreePath;
    worktreeAbsPath = wtp.startsWith("/") ? wtp : `${wp}/${wtp}`;
  }

  // Open the task detail panel so the execute agent UI is immediately visible.
  // NOTE: The panel does NOT auto-open on drag. setSelectedTask is intentionally removed.

  // ── Auto-execution ─────────────────────────────────────────────
  // Skip if the execute session is already running (guard against double-fire)
  const execSessionKey = `execute:${task.id}`;
  const isRunning =
    usePlanStore.getState().sessions[execSessionKey]?.isRunning ?? false;
  if (isRunning) return;

  // Re-read the latest task state (path and frontmatter may have changed)
  const latestTask =
    useDataStore.getState().tasks.find((t) => t.id === task.id) ?? movedTask;

  // Resolve the agent via 3-level fallback:
  //   1. execSessionAgent from task frontmatter
  //   2. defaultExecutionAgent from workspace config
  //   3. "opencode"
  await useWorkspaceStore.getState().fetchDefaults(wp);
  const defaults = useWorkspaceStore.getState().workspaceDefaults[wp];
  const agent =
    latestTask.execSessionAgent ??
    defaults?.defaultExecutionAgent ??
    "opencode";

  const model = latestTask.execModel ?? defaults?.defaultExecutionModel ?? null;

  // Validate model against cached list — stale selections fall back to null.
  // Read from the shared models cache (keyed by workspacePath:agent) so we
  // don't fire a redundant IPC call here (TaskCards already populated it).
  const cacheKey = `${wp}:${agent}`;
  const cachedModels = usePlanStore.getState().modelsCache[cacheKey];
  const resolvedModel =
    model !== null && Array.isArray(cachedModels) && cachedModels.length > 0
      ? cachedModels.includes(model)
        ? model
        : null
      : model;

  // Read full task content to build the execution prompt
  const rawResult = await window.api.tasks.readRaw(wp, latestTask.filePath);
  if (!rawResult.ok) {
    showToast("Could not read task file — execution not started", "error");
    return;
  }

  const message = buildFirstExecutionMessage(latestTask, rawResult.data);

  // Initialise the in-memory plan session so startAgentMessage has a slot to write to
  usePlanStore
    .getState()
    .initSession(execSessionKey, agent, resolvedModel, null);

  const sendResult = await window.api.plan.send({
    taskId: task.id,
    mode: "execute",
    agent,
    model: resolvedModel,
    message,
    displayMessage: "",
    sessionId: null,
    workspacePath: wp,
    taskFilePath: latestTask.filePath,
    ...(worktreeAbsPath ? { worktreePath: worktreeAbsPath } : {}),
  });

  if (!sendResult.ok) {
    showToast(`Execution failed to start: ${sendResult.error}`, "error");
  } else {
    // Append user message BEFORE starting agent message so it appears on top
    // (user message is last in the array, agent bubble comes after)
    usePlanStore
      .getState()
      .appendUserMessage(
        execSessionKey,
        `Sent plan for ticket '${task.title}' to Agent`,
      );
    // Create the agent message slot and set isRunning: true so the running
    // indicator on the card is visible without the user opening the panel.
    usePlanStore.getState().startAgentMessage(execSessionKey);
  }
}

async function handleDragToDone(task: TaskInfo): Promise<void> {
  const wp = useWorkspaceStore.getState().activeWorkspacePath;
  if (!wp) return;

  if (task.worktree) {
    // Show confirmation dialog before tearing down the worktree
    const confirmed = await useDialogStore.getState().show({
      title: "Remove worktree?",
      message: `The branch "${task.branch ?? "(unknown)"}" will be kept.\nThe working tree at ${task.worktree} will be deleted.`,
      confirmLabel: "Remove worktree",
      cancelLabel: "Keep worktree",
    });

    if (!confirmed) return;
  }

  // Optimistic patch + move
  useDataStore.getState().patchTask({ ...task, status: "done" });
  const moveOk = await moveTask(task.filePath, "done");
  if (!moveOk) {
    useDataStore.getState().patchTask(task); // rollback
    showToast("Failed to move task to Done", "error");
    return;
  }

  // Get the updated task (filePath changed after move)
  const movedTask = useDataStore
    .getState()
    .tasks.find((t) => t.id === task.id) ?? {
    ...task,
    status: "done" as TaskStatus,
  };

  if (task.worktree) {
    const result = await window.api.git.teardownWorktreeForTask({
      workspacePath: wp,
      taskFilePath: movedTask.filePath,
      worktreePath: task.worktree,
    });

    if (!result.ok) {
      if (result.error.includes("DIRTY_WORKING_TREE")) {
        showToast(
          "Worktree has uncommitted changes. Commit or stash, then remove manually.",
          "warning",
        );
      } else {
        showToast(
          `Task done, but worktree removal failed: ${result.error}`,
          "warning",
        );
      }
      return;
    }

    useDataStore
      .getState()
      .patchTask({ ...movedTask, worktree: null, branch: null });

    showToast("Task done. Worktree removed. Branch kept.", "success");
  } else {
    showToast("Task done.", "success");
  }
}
