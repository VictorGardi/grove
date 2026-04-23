import { useEffect, useState, useCallback, memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { TaskInfo } from "@shared/types";
import { useDataStore } from "../../stores/useDataStore";
import { useWorktreeStore } from "../../stores/useWorktreeStore";
import { usePlanStore } from "../../stores/usePlanStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useBoardStore } from "../../stores/useBoardStore";
import { useNavStore } from "../../stores/useNavStore";
import { useTmuxLivenessStore } from "../../stores/useTmuxLivenessStore";
import { ContextMenu } from "../Sidebar/ContextMenu";
import type { ContextMenuItem } from "../Sidebar/ContextMenu";
import { archiveTask } from "../../actions/taskActions";
import styles from "./TaskCard.module.css";

interface TaskCardProps {
  task: TaskInfo;
  /** When search is active: true = matched, false = not matched, undefined = no search */
  isSearchMatch?: boolean;
}

export const TaskCard = memo(function TaskCard({
  task,
  isSearchMatch,
}: TaskCardProps): React.JSX.Element {
  const selectedTaskId = useDataStore((s) => s.selectedTaskId);
  const isSelected = task.id === selectedTaskId;
  const worktreeCreating = useWorktreeStore((s) => s.creatingIds.has(task.id));

  const focusedTaskId = useBoardStore((s) => s.focusedTaskId);
  const isFocused = task.id === focusedTaskId;

  // workspacePath is needed for the ensureModels effect below
  const workspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);

  // Read tmux liveness and agent state from the shared store
  const execTmuxAlive = useTmuxLivenessStore(
    (s) => s.liveness[`${workspacePath}:execute:${task.id}`]?.alive ?? false,
  );
  const planTmuxAlive = useTmuxLivenessStore(
    (s) => s.liveness[`${workspacePath}:plan:${task.id}`]?.alive ?? false,
  );

  // Agent state from terminal parsing
  const execAgentState = useTmuxLivenessStore(
    (s) => s.liveness[`${workspacePath}:execute:${task.id}`]?.state,
  );
  const planAgentState = useTmuxLivenessStore(
    (s) => s.liveness[`${workspacePath}:plan:${task.id}`]?.state,
  );

  // Reviewer sessions (used for the isAgentRunning fallback)
  const reviewerIsRunning = usePlanStore(
    (s) =>
      s.sessions[`execute-review:${task.id}`]?.isRunning ||
      s.sessions[`execute:review:${task.id}`]?.isRunning ||
      false,
  );

  // isAgentRunning: true when tmux session is alive (taskTerminal mode)
  const isAgentRunning = execTmuxAlive || reviewerIsRunning;
  const isPlanningRunning = planTmuxAlive;

  // Agent state from terminal parsing (active/interrupted/waiting/idle)

  const isDodComplete = task.dodTotal > 0 && task.dodDone >= task.dodTotal;

  // Resolve which agent is displayed on this card
  const cardAgent = task.execSessionAgent ?? "opencode";

  const ensureModels = usePlanStore((s) => s.ensureModels);

  // Fire one IPC call per (workspacePath, agent) pair the first time a card
  // for that combination renders. Subsequent cards read synchronously.
  useEffect(() => {
    if (
      workspacePath &&
      (task.status === "backlog" || task.status === "doing")
    ) {
      void ensureModels(workspacePath, cardAgent);
    }
  }, [workspacePath, cardAgent, task.status, ensureModels]);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
  });

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const handleClick = useCallback(() => {
    useBoardStore.getState().clearFocusedTask();
    useDataStore.getState().setSelectedTask(task.id);
    useNavStore.getState().setActiveView("task");
  }, [task.id]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleArchive = useCallback(() => {
    if (
      window.confirm("Archive this task? It will be moved to .grove/tasks/archive/")
    ) {
      archiveTask(task.filePath);
    }
    setContextMenu(null);
  }, [task.filePath]);

  const contextMenuItems: ContextMenuItem[] = [
    {
      label: "Archive task",
      onClick: handleArchive,
      disabled: isAgentRunning || isPlanningRunning,
      destructive: true,
    },
  ];

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`${styles.card} ${isSelected ? styles.cardSelected : ""} ${isFocused ? styles.cardFocused : ""} ${isDragging ? styles.cardDragging : ""} ${isSearchMatch === true ? styles.cardSearchMatch : ""}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Row 1: Title */}
      <div className={styles.titleRow}>
        <span className={styles.title}>{task.title}</span>
      </div>

      {/* Row 2: Branch badge — shown when worktree is active or being created */}
      {worktreeCreating && (
        <div className={styles.branchRow}>
          <span className={styles.branchCreating}>Creating worktree…</span>
        </div>
      )}
      {!worktreeCreating && task.branch && task.status !== "backlog" && (
        <div className={styles.branchRow}>
          <span className={styles.branchIcon}>&#x2387;</span>
          <span className={styles.branchName}>{task.branch}</span>
        </div>
      )}

      {/* Row 3: Agent state indicators */}
      {task.status === "doing" &&
        execTmuxAlive &&
        (execAgentState === "starting" || planAgentState === "starting") && (
          <div className={styles.startingRow}>
            <span className={styles.startingDot} />
            <span className={styles.startingLabel}>Starting agent session</span>
          </div>
        )}
      {task.status === "doing" &&
        execTmuxAlive &&
        (execAgentState === "active" || planAgentState === "active") && (
          <div className={styles.agentRunningRow}>
            <span className={styles.agentRunningDot} />
            <span className={styles.agentRunningLabel}>agent running</span>
          </div>
        )}
      {task.status === "doing" &&
        execTmuxAlive &&
        execAgentState !== "active" &&
        planAgentState !== "active" &&
        execAgentState !== "starting" &&
        planAgentState !== "starting" && (
          <div className={styles.waitingRow}>
            <span className={styles.waitingDot} />
            <span className={styles.waitingLabel}>Waiting for input</span>
          </div>
        )}
      {task.status === "backlog" &&
        planTmuxAlive &&
        (planAgentState === "starting" || execAgentState === "starting") && (
          <div className={styles.startingRow}>
            <span className={styles.startingDot} />
            <span className={styles.startingLabel}>Starting agent session</span>
          </div>
        )}
      {task.status === "backlog" &&
        planTmuxAlive &&
        (planAgentState === "active" || execAgentState === "active") && (
          <div className={styles.agentRunningRow}>
            <span className={styles.agentRunningDot} />
            <span className={styles.agentRunningLabel}>agent running</span>
          </div>
        )}
      {task.status === "backlog" &&
        planTmuxAlive &&
        planAgentState !== "active" &&
        execAgentState !== "active" &&
        planAgentState !== "starting" &&
        execAgentState !== "starting" && (
          <div className={styles.waitingRow}>
            <span className={styles.waitingDot} />
            <span className={styles.waitingLabel}>Waiting for input</span>
          </div>
        )}
      {task.status === "review" &&
        execTmuxAlive &&
        (execAgentState === "starting" || planAgentState === "starting") && (
          <div className={styles.startingRow}>
            <span className={styles.startingDot} />
            <span className={styles.startingLabel}>Starting agent session</span>
          </div>
        )}
      {task.status === "review" &&
        execTmuxAlive &&
        (execAgentState === "active" || planAgentState === "active") && (
          <div className={styles.agentRunningRow}>
            <span className={styles.agentRunningDot} />
            <span className={styles.agentRunningLabel}>agent running</span>
          </div>
        )}
      {task.status === "review" &&
        execTmuxAlive &&
        execAgentState !== "active" &&
        planAgentState !== "active" &&
        execAgentState !== "starting" &&
        planAgentState !== "starting" && (
          <div className={styles.waitingRow}>
            <span className={styles.waitingDot} />
            <span className={styles.waitingLabel}>Waiting for input</span>
          </div>
        )}

      {/* Row 3b: Review pending / ship-it */}
      {task.status === "doing" && reviewerIsRunning && (
        <div className={styles.waitingRow}>
          <span className={styles.reviewPendingLabel}>review pending</span>
        </div>
      )}
      {task.status === "doing" &&
        !reviewerIsRunning &&
        isDodComplete &&
        !execTmuxAlive && (
          <div className={styles.shipItRow}>
            <span className={styles.shipItDot} />
            <span className={styles.shipItLabel}>ship it 🚢</span>
          </div>
        )}

      {/* Row 4: Description preview */}
      {task.description && (
        <div className={styles.description}>{task.description}</div>
      )}

      {/* Row 4: Tag pills */}
      {task.tags.length > 0 && (
        <div className={styles.tags}>
          {task.tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              {tag}
            </span>
          ))}
        </div>
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
});
