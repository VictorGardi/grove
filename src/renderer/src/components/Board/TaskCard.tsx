import { useDraggable } from "@dnd-kit/core";
import type { TaskInfo } from "@shared/types";
import { useNavStore } from "../../stores/useNavStore";
import { useDataStore } from "../../stores/useDataStore";
import { useWorktreeStore } from "../../stores/useWorktreeStore";
import styles from "./TaskCard.module.css";

interface TaskCardProps {
  task: TaskInfo;
  milestoneName: string | null;
}

const PRIORITY_CLASSES: Record<string, string> = {
  critical: styles.priorityCritical,
  high: styles.priorityHigh,
  medium: styles.priorityMedium,
  low: styles.priorityLow,
};

export function TaskCard({
  task,
  milestoneName,
}: TaskCardProps): React.JSX.Element {
  const selectedTaskId = useDataStore((s) => s.selectedTaskId);
  const isSelected = task.id === selectedTaskId;
  const worktreeCreating = useWorktreeStore((s) => s.creatingIds.has(task.id));

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
  });

  function handleClick(): void {
    useDataStore.getState().setSelectedTask(task.id);
  }

  function handleMilestoneClick(e: React.MouseEvent): void {
    e.stopPropagation();
    if (task.milestone) {
      useNavStore.getState().setActiveView("milestones");
      useDataStore.getState().setSelectedMilestone(task.milestone);
    }
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`${styles.card} ${isSelected ? styles.cardSelected : ""} ${isDragging ? styles.cardDragging : ""}`}
      onClick={handleClick}
    >
      {/* Row 1: Title + priority badge */}
      <div className={styles.titleRow}>
        <span className={styles.title}>{task.title}</span>
        {task.priority && (
          <span
            className={`${styles.priority} ${PRIORITY_CLASSES[task.priority] || ""}`}
          >
            {task.priority}
          </span>
        )}
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

      {/* Row 3: Description preview */}
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

      {/* Row 5: Milestone label */}
      {task.milestone && (
        <div className={styles.milestone} onClick={handleMilestoneClick}>
          <span className={styles.milestoneDiamond}>&#9670;</span>
          {milestoneName || task.milestone}
        </div>
      )}
    </div>
  );
}
