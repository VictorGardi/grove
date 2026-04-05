import { useEffect, useState, useCallback } from "react";
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

  // workspacePath is needed for tmuxCheck calls
  const workspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);

  // Track actual tmux session liveness for execute and plan modes independently.
  // This is a fallback for when the in-memory isRunning flag is stale (e.g. after
  // component remount, app restart, or a reconnect race condition).
  const [execTmuxAlive, setExecTmuxAlive] = useState(false);
  const [planTmuxAlive, setPlanTmuxAlive] = useState(false);

  // Read isRunning from the store for both modes
  const execIsRunning = usePlanStore(
    (s) => s.sessions[`execute:${task.id}`]?.isRunning ?? false,
  );
  const planIsRunning = usePlanStore(
    (s) => s.sessions[`plan:${task.id}`]?.isRunning ?? false,
  );

  // Check the actual tmux session liveness when isRunning is false.
  // The IPC handler derives the session name independently via buildTmuxSessionName,
  // so we don't strictly require task.execTmuxSession to be set — but we use it as
  // a hint: if no session name was ever persisted, skip the check to avoid IPC noise
  // for tasks that never had an agent run. Tasks that crashed mid-frontmatter-write
  // (execTmuxSession not saved) may miss the alive detection — an acceptable edge case.
  const checkExecTmux = useCallback(async () => {
    if (!workspacePath || !task.execTmuxSession) {
      setExecTmuxAlive(false);
      return;
    }
    try {
      const result = await window.api.plan.tmuxCheck({
        workspacePath,
        taskId: task.id,
        mode: "execute",
      });
      setExecTmuxAlive(result.ok && result.data.alive);
    } catch {
      setExecTmuxAlive(false);
    }
  }, [workspacePath, task.id, task.execTmuxSession]);

  const checkPlanTmux = useCallback(async () => {
    if (!workspacePath || !task.planTmuxSession) {
      setPlanTmuxAlive(false);
      return;
    }
    try {
      const result = await window.api.plan.tmuxCheck({
        workspacePath,
        taskId: task.id,
        mode: "plan",
      });
      setPlanTmuxAlive(result.ok && result.data.alive);
    } catch {
      setPlanTmuxAlive(false);
    }
  }, [workspacePath, task.id, task.planTmuxSession]);

  // Check tmux liveness on mount and whenever the relevant session name changes.
  // Only poll when isRunning is false — if isRunning is true, the store already
  // knows the agent is running, so no IPC needed.
  useEffect(() => {
    if (execIsRunning) {
      // Store says running — trust it; no tmux poll needed
      setExecTmuxAlive(false);
      return;
    }
    void checkExecTmux();
    // Poll every 5 seconds while the card is visible and isRunning is false
    const interval = setInterval(() => void checkExecTmux(), 5000);
    return () => clearInterval(interval);
  }, [execIsRunning, checkExecTmux]);

  useEffect(() => {
    if (planIsRunning) {
      setPlanTmuxAlive(false);
      return;
    }
    void checkPlanTmux();
    const interval = setInterval(() => void checkPlanTmux(), 5000);
    return () => clearInterval(interval);
  }, [planIsRunning, checkPlanTmux]);

  // Reviewer sessions (used for the isAgentRunning fallback)
  const reviewerIsRunning = usePlanStore(
    (s) =>
      s.sessions[`execute-review:${task.id}`]?.isRunning ||
      s.sessions[`execute:review:${task.id}`]?.isRunning ||
      false,
  );

  // isAgentRunning: true when the store says running OR when tmux session is alive
  const isAgentRunning = execIsRunning || execTmuxAlive || reviewerIsRunning;

  const isPlanningRunning = planIsRunning || planTmuxAlive;

  // Read raw session state from the store to derive waiting/error flags below.
  // Using separate, pure selectors (no external state captured) avoids stale
  // closure issues that arise when React state values are captured inside a
  // Zustand selector.
  const execSession = usePlanStore((s) => s.sessions[`execute:${task.id}`]);
  const planSession = usePlanStore((s) => s.sessions[`plan:${task.id}`]);

  // "Waiting for input" — agent exited cleanly (or never set exit code) but
  // is not currently running (store flag + tmux check both say idle).
  const isExecuteWaiting =
    !!execSession &&
    execSession.messages.length > 0 &&
    !execSession.isRunning &&
    !execTmuxAlive &&
    (execSession.lastExitCode === null || execSession.lastExitCode === 0);

  const isPlanWaiting =
    !!planSession &&
    planSession.messages.length > 0 &&
    !planSession.isRunning &&
    !planTmuxAlive &&
    (planSession.lastExitCode === null || planSession.lastExitCode === 0);

  // "Session failed" — agent exited with non-zero code AND is not currently
  // running (tmux alive takes precedence — a new run supersedes old exit code).
  const isExecuteErrored =
    !!execSession &&
    execSession.messages.length > 0 &&
    !execSession.isRunning &&
    !execTmuxAlive &&
    execSession.lastExitCode !== null &&
    execSession.lastExitCode !== 0;

  const isPlanErrored =
    !!planSession &&
    planSession.messages.length > 0 &&
    !planSession.isRunning &&
    !planTmuxAlive &&
    planSession.lastExitCode !== null &&
    planSession.lastExitCode !== 0;

  const isDodComplete = task.dodTotal > 0 && task.dodDone >= task.dodTotal;

  const reviewerLastExitCode = usePlanStore((s) => {
    const r1 = s.sessions[`execute-review:${task.id}`];
    const r2 = s.sessions[`execute:review:${task.id}`];
    return r1?.lastExitCode ?? r2?.lastExitCode ?? null;
  });

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
      {task.status === "doing" && reviewerIsRunning && (
        <div className={styles.waitingRow}>
          <span className={styles.reviewPendingLabel}>review pending</span>
        </div>
      )}
      {task.status === "doing" &&
        !reviewerIsRunning &&
        isDodComplete &&
        (reviewerLastExitCode === 0 ||
          (isExecuteWaiting && reviewerLastExitCode === null)) && (
          <div className={styles.shipItRow}>
            <span className={styles.shipItDot} />
            <span className={styles.shipItLabel}>ship it 🚢</span>
          </div>
        )}
      {task.status === "doing" &&
        isExecuteWaiting &&
        task.dodTotal > 0 &&
        task.dodDone < task.dodTotal &&
        !reviewerIsRunning && (
          <div className={styles.waitingRow}>
            <span className={styles.waitingDot} />
            <span className={styles.waitingLabel}>Waiting for input</span>
          </div>
        )}
      {task.status === "backlog" && isPlanWaiting && (
        <div className={styles.waitingRow}>
          <span className={styles.waitingDot} />
          <span className={styles.waitingLabel}>Waiting for input</span>
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
