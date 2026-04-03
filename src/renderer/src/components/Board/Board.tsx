import { useMemo, useState, useCallback } from "react";
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
import { useTerminalStore } from "../../stores/useTerminalStore";
import { useNavStore } from "../../stores/useNavStore";
import { useDialogStore } from "../../stores/useDialogStore";
import { showToast } from "../../stores/useToastStore";
import type { TaskInfo, TaskStatus } from "@shared/types";
import { moveTask } from "../../actions/taskActions";
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
  const milestones = useDataStore((s) => s.milestones);
  const milestoneFilter = useDataStore((s) => s.milestoneFilter);
  const loading = useDataStore((s) => s.loading);
  const [activeTask, setActiveTask] = useState<TaskInfo | null>(null);

  // Pointer sensor with activation distance to avoid accidental drags on click
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Filter tasks by milestone
  const filtered = useMemo(() => {
    if (milestoneFilter === null) return tasks;
    if (milestoneFilter === "none") return tasks.filter((t) => !t.milestone);
    return tasks.filter((t) => t.milestone === milestoneFilter);
  }, [tasks, milestoneFilter]);

  // Build milestone ID -> title lookup for card rendering
  const milestoneMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of milestones) map.set(m.id, m.title);
    return map;
  }, [milestones]);

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
    [tasks], // eslint-disable-line react-hooks/exhaustive-deps
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
      <BoardToolbar milestones={milestones} />
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className={styles.columns}>
          {COLUMNS.map((col) => {
            const colTasks = filtered.filter((t) => t.status === col.status);
            return (
              <Column
                key={col.status}
                status={col.status}
                label={col.label}
                color={col.color}
                tasks={colTasks}
                milestoneMap={milestoneMap}
              />
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div className={styles.dragOverlay}>
              <TaskCard
                task={activeTask}
                milestoneName={
                  activeTask.milestone
                    ? (milestoneMap.get(activeTask.milestone) ?? null)
                    : null
                }
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// ── Worktree drag handlers (module-level async, not hooks) ────────────────────

/** Resolve agent field + task metadata to CLI command text */
function agentToCommand(agent: string | null, task: TaskInfo): string | null {
  if (!agent) return null;

  if (agent === "opencode") {
    const parts = ["opencode", "run"];
    if (task.title) {
      parts.push("--title", `"${task.title}"`);
    }
    if (task.description) {
      const escaped = task.description.replace(/"/g, '\\"');
      parts.push(`"${escaped}"`);
    }
    return parts.join(" ");
  }

  const map: Record<string, string> = {
    "claude-code": "claude",
    copilot: "gh copilot suggest",
    codex: "codex",
    aider: "aider",
  };
  return map[agent] ?? null;
}

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
  const movedTask =
    useDataStore.getState().tasks.find((t) => t.id === task.id) ?? task;

  // Mark as creating — shows pulsing "Creating worktree…" on card
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
      // Roll back: move task back to original status
      await moveTask(movedTask.filePath, task.status);
    }
    showToast(worktreeErrorMessage(result.error), "error");
    return;
  }

  // Patch in-memory state immediately — don't wait for chokidar
  useDataStore.getState().patchTask({
    ...movedTask,
    status: "doing",
    worktree: result.data.worktreePath,
    branch: result.data.branchName,
  });

  if (!result.data.alreadyExisted) {
    showToast(`Worktree created: ${result.data.branchName}`, "success");
  }

  // Auto-create terminal tab for the worktree
  const worktreeAbsPath = wp + "/" + result.data.worktreePath;
  const agentCmd = agentToCommand(task.agent, task);
  const tabId = `wt-${task.id}`;

  // Create the PTY BEFORE adding the tab so it exists when TerminalTabView mounts.
  // TerminalTabView no longer calls pty.create — it only manages the xterm UI.
  const ptyResult = await window.api.pty.create(tabId, worktreeAbsPath);
  if (!ptyResult.ok) {
    showToast(`Terminal error: ${ptyResult.error}`, "error");
    // Still open the tab — user can press a key to restart
  }

  useTerminalStore.getState().addTab({
    id: tabId,
    label: result.data.branchName,
    workspacePath: wp,
    worktreePath: worktreeAbsPath,
    taskId: task.id,
  });

  // Schedule agent command outside React — shell needs ~1 s to print its prompt
  if (ptyResult.ok && agentCmd) {
    setTimeout(() => {
      window.api.pty.write(tabId, agentCmd + "\n");
    }, 1000);
  }

  // Open the terminal panel if it's collapsed
  if (!useNavStore.getState().terminalPanelOpen) {
    useNavStore.getState().toggleTerminalPanel();
  }
}

async function handleDragToDone(task: TaskInfo): Promise<void> {
  const wp = useWorkspaceStore.getState().activeWorkspacePath;
  if (!wp) return;

  // Show confirmation dialog before doing anything
  const confirmed = await useDialogStore.getState().show({
    title: "Remove worktree?",
    message: `The branch "${task.branch ?? "(unknown)"}" will be kept.\nThe working tree at ${task.worktree} will be deleted.`,
    confirmLabel: "Remove worktree",
    cancelLabel: "Keep worktree",
  });

  if (!confirmed) return;

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

  const result = await window.api.git.teardownWorktreeForTask({
    workspacePath: wp,
    taskFilePath: movedTask.filePath,
    worktreePath: task.worktree!,
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

  // Remove terminal tab for this worktree
  const termTabId = `wt-${task.id}`;
  const termTab = useTerminalStore
    .getState()
    .tabs.find((t) => t.id === termTabId);
  if (termTab) {
    useTerminalStore.getState().removeTab(termTabId);
  }

  showToast("Task done. Worktree removed. Branch kept.", "success");
}
