import { useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { TaskInfo } from "@shared/types";
import { useDataStore } from "../../stores/useDataStore";
import { useWorktreeStore } from "../../stores/useWorktreeStore";
import { usePlanStore } from "../../stores/usePlanStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { updateTask } from "../../actions/taskActions";
import styles from "./TaskCard.module.css";

interface TaskCardProps {
  task: TaskInfo;
  /** When search is active: true = matched, false = not matched, undefined = no search */
  isSearchMatch?: boolean;
}

export function TaskCard({
  task,
  isSearchMatch,
}: TaskCardProps): React.JSX.Element {
  const selectedTaskId = useDataStore((s) => s.selectedTaskId);
  const isSelected = task.id === selectedTaskId;
  const worktreeCreating = useWorktreeStore((s) => s.creatingIds.has(task.id));
  const isAgentRunning = usePlanStore(
    (s) => s.sessions[`execute:${task.id}`]?.isRunning ?? false,
  );
  const isPlanningRunning = usePlanStore(
    (s) => s.sessions[`plan:${task.id}`]?.isRunning ?? false,
  );

  const isExecuteWaiting = usePlanStore((s) => {
    const session = s.sessions[`execute:${task.id}`];
    if (!session || session.messages.length === 0 || session.isRunning)
      return false;
    return session.lastExitCode === null || session.lastExitCode === 0;
  });
  const isPlanWaiting = usePlanStore((s) => {
    const session = s.sessions[`plan:${task.id}`];
    if (!session || session.messages.length === 0 || session.isRunning)
      return false;
    return session.lastExitCode === null || session.lastExitCode === 0;
  });

  const isDodComplete = task.dodTotal > 0 && task.dodDone >= task.dodTotal;

  const isExecuteErrored = usePlanStore((s) => {
    const session = s.sessions[`execute:${task.id}`];
    if (!session || session.messages.length === 0 || session.isRunning)
      return false;
    return session.lastExitCode !== null && session.lastExitCode !== 0;
  });
  const isPlanErrored = usePlanStore((s) => {
    const session = s.sessions[`plan:${task.id}`];
    if (!session || session.messages.length === 0 || session.isRunning)
      return false;
    return session.lastExitCode !== null && session.lastExitCode !== 0;
  });

  // Resolve which agent is displayed on this card
  const cardAgent = task.execSessionAgent ?? "opencode";

  // Read workspace path and defaults for model fallback label
  const workspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const defaultExecutionModel = useWorkspaceStore(
    (s) =>
      s.workspaceDefaults[s.activeWorkspacePath ?? ""]?.defaultExecutionModel,
  );

  // Read models from the shared cache — null means loading, undefined means not fetched yet
  const modelsCacheEntry = usePlanStore(
    (s) => s.modelsCache[`${workspacePath ?? ""}:${cardAgent}`],
  );
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

  // Derive available models from cache: null/undefined → loading, [] → show "default" only
  const modelsLoading = modelsCacheEntry === null;
  const availableModels: string[] = Array.isArray(modelsCacheEntry)
    ? modelsCacheEntry
    : [];

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
  });

  function handleClick(): void {
    useDataStore.getState().setSelectedTask(task.id);
  }

  const showControls = task.status === "backlog" || task.status === "doing";

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`${styles.card} ${isSelected ? styles.cardSelected : ""} ${isDragging ? styles.cardDragging : ""} ${isSearchMatch === true ? styles.cardSearchMatch : ""}`}
      onClick={handleClick}
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
      {!worktreeCreating && task.branch && (
        <div className={styles.branchRow}>
          <span className={styles.branchIcon}>&#x2387;</span>
          <span className={styles.branchName}>{task.branch}</span>
        </div>
      )}

      {/* Row 3: Agent running indicator — doing tasks (execution) or backlog tasks (planning) */}
      {task.status === "doing" && isAgentRunning && (
        <div className={styles.agentRunningRow}>
          <span className={styles.agentRunningDot} />
          <span className={styles.agentRunningLabel}>agent running</span>
        </div>
      )}
      {task.status === "backlog" && isPlanningRunning && (
        <div className={styles.agentRunningRow}>
          <span className={styles.agentRunningDot} />
          <span className={styles.agentRunningLabel}>agent running</span>
        </div>
      )}

      {/* Row 3b: Waiting for input indicator */}
      {task.status === "doing" && isExecuteWaiting && isDodComplete && (
        <div className={styles.shipItRow}>
          <span className={styles.shipItDot} />
          <span className={styles.shipItLabel}>ship it 🚢</span>
        </div>
      )}
      {task.status === "doing" && isExecuteWaiting && !isDodComplete && (
        <div className={styles.waitingRow}>
          <span className={styles.waitingDot} />
          <span className={styles.waitingLabel}>waiting for you</span>
        </div>
      )}
      {task.status === "backlog" && isPlanWaiting && (
        <div className={styles.waitingRow}>
          <span className={styles.waitingDot} />
          <span className={styles.waitingLabel}>waiting for you</span>
        </div>
      )}

      {/* Row 3c: Error indicator */}
      {task.status === "doing" && isExecuteErrored && (
        <div className={styles.errorRow}>
          <span className={styles.errorDot} />
          <span className={styles.errorLabel}>session failed</span>
        </div>
      )}
      {task.status === "backlog" && isPlanErrored && (
        <div className={styles.errorRow}>
          <span className={styles.errorDot} />
          <span className={styles.errorLabel}>session failed</span>
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

      {/* Row 5: worktree toggle + model select — backlog and doing tasks */}
      {showControls && (
        <div
          className={styles.worktreeRow}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={`${styles.worktreeToggle} ${task.useWorktree ? styles.worktreeToggleActive : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              updateTask(task.filePath, { useWorktree: !task.useWorktree });
            }}
            title={
              task.useWorktree
                ? "Running in git worktree — click to switch to root repo"
                : "Running in root repo — click to switch to git worktree"
            }
          >
            {task.useWorktree ? "worktree" : "root repo"}
          </button>

          {/* Model dropdown — backlog and doing tasks */}
          <select
            className={`${styles.modelSelect} ${isAgentRunning || worktreeCreating ? styles.modelSelectDisabled : ""}`}
            value={task.execModel ?? ""}
            disabled={isAgentRunning || worktreeCreating}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              const val = e.target.value;
              updateTask(task.filePath, {
                execModel: val === "" ? null : val,
              });
            }}
            title="Execution model for this task"
          >
            {modelsLoading ? (
              <option value="" disabled>
                loading…
              </option>
            ) : (
              <>
                <option value="">{defaultExecutionModel ?? "default"}</option>
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>
      )}
    </div>
  );
}
