import { useDroppable } from "@dnd-kit/core";
import type { TaskInfo, TaskStatus } from "@shared/types";
import { TaskCard } from "./TaskCard";
import styles from "./Column.module.css";

interface ColumnProps {
  status: TaskStatus;
  label: string;
  color: string;
  tasks: TaskInfo[];
}

export function Column({
  status,
  label,
  color,
  tasks,
}: ColumnProps): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      className={`${styles.column} ${isOver ? styles.columnOver : ""}`}
      ref={setNodeRef}
    >
      <div className={styles.header}>
        <span className={styles.dot} style={{ background: color }} />
        <span className={styles.label}>{label}</span>
        <span className={styles.count}>{tasks.length}</span>
      </div>
      <div className={styles.cardList}>
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}
