import { useDraggable } from "@dnd-kit/core";
import type { TaskInfo } from "@shared/types";
import { useDataStore } from "../../stores/useDataStore";
import { useWorktreeStore } from "../../stores/useWorktreeStore";
import { updateTask } from "../../actions/taskActions";
import styles from "./TaskCard.module.css";

interface TaskCardProps {
  task: TaskInfo;
}

export function TaskCard({ task }: TaskCardProps): React.JSX.Element {
  const selectedTaskId = useDataStore((s) => s.selectedTaskId);
  const isSelected = task.id === selectedTaskId;
  const worktreeCreating = useWorktreeStore((s) => s.creatingIds.has(task.id));

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
      className={`${styles.card} ${isSelected ? styles.cardSelected : ""} ${isDragging ? styles.cardDragging : ""}`}
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

      {/* Row 5: autoRun toggle — backlog tasks only */}
      {task.status === "backlog" && (
        <div className={styles.autoRunRow} onClick={(e) => e.stopPropagation()}>
          <button
            className={`${styles.autoRunToggle} ${task.autoRun ? styles.autoRunToggleActive : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              updateTask(task.filePath, { autoRun: !task.autoRun });
            }}
            title={
              task.autoRun
                ? "Auto-run on: click to disable"
                : "Auto-run off: click to enable"
            }
          >
            {task.autoRun ? "auto-run: on" : "auto-run: off"}
          </button>
        </div>
      )}
    </div>
  );
}
