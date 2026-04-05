import { useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { TaskInfo } from "@shared/types";
import { useDataStore } from "../../stores/useDataStore";
import { useWorktreeStore } from "../../stores/useWorktreeStore";
import { usePlanStore } from "../../stores/usePlanStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
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
  const isAgentRunning = usePlanStore((s) => {
    // Consider the execute session as running, or a dedicated reviewer session.
    const execRunning = s.sessions[`execute:${task.id}`]?.isRunning ?? false;
    const reviewerRunning =
      s.sessions[`execute-review:${task.id}`]?.isRunning ??
      s.sessions[`execute:review:${task.id}`]?.isRunning ??
      false;
    return execRunning || reviewerRunning;
  });
  const isPlanningRunning = usePlanStore(
    (s) => s.sessions[`plan:${task.id}`]?.isRunning ?? false,
  );

  const isExecuteWaiting = usePlanStore((s) => {
    const session = s.sessions[`execute:${task.id}`];
    if (!session || session.messages.length === 0 || session.isRunning)
      return false;
    return session.lastExitCode === null || session.lastExitCode === 0;
  });
  const isReviewerRunning = usePlanStore((s) =>
    Boolean(
      s.sessions[`execute-review:${task.id}`]?.isRunning ||
      s.sessions[`execute:review:${task.id}`]?.isRunning,
    ),
  );
  const reviewerLastExitCode = usePlanStore((s) => {
    const r1 = s.sessions[`execute-review:${task.id}`];
    const r2 = s.sessions[`execute:review:${task.id}`];
    return r1?.lastExitCode ?? r2?.lastExitCode ?? null;
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

  // Read workspace path — needed for ensureModels pre-fetching
  const workspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);

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

  function handleClick(): void {
    useDataStore.getState().setSelectedTask(task.id);
  }

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

      {/* Row 3b: Review / ship-it indicator
          - Do not show "waiting for you" for doing tasks anymore.
          - While a reviewer subagent is running show an optional "review pending" badge.
          - After reviewer ends, show ship it if DoD complete, or session failed if reviewer signalled failure. */}
      {task.status === "doing" && isReviewerRunning && (
        <div className={styles.waitingRow}>
          <span className={styles.reviewPendingLabel}>review pending</span>
        </div>
      )}
      {task.status === "doing" &&
        !isReviewerRunning &&
        isDodComplete &&
        (reviewerLastExitCode === 0 ||
          (isExecuteWaiting && reviewerLastExitCode === null)) && (
          <div className={styles.shipItRow}>
            <span className={styles.shipItDot} />
            <span className={styles.shipItLabel}>ship it 🚢</span>
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
    </div>
  );
}
