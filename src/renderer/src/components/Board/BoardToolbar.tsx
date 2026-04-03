import { useDataStore } from "../../stores/useDataStore";
import { createTask } from "../../actions/taskActions";
import type { MilestoneInfo } from "@shared/types";
import styles from "./BoardToolbar.module.css";

interface BoardToolbarProps {
  milestones: MilestoneInfo[];
}

export function BoardToolbar({
  milestones,
}: BoardToolbarProps): React.JSX.Element {
  const milestoneFilter = useDataStore((s) => s.milestoneFilter);
  const setMilestoneFilter = useDataStore((s) => s.setMilestoneFilter);

  const openMilestones = milestones.filter((m) => m.status === "open");

  function handleNewTask(): void {
    createTask("New task");
  }

  return (
    <div className={styles.toolbar}>
      <button className={styles.newTaskBtn} onClick={handleNewTask}>
        + New task
      </button>
      <select
        className={styles.select}
        value={milestoneFilter ?? "__all__"}
        onChange={(e) => {
          const val = e.target.value;
          if (val === "__all__") setMilestoneFilter(null);
          else if (val === "none") setMilestoneFilter("none");
          else setMilestoneFilter(val);
        }}
      >
        <option value="__all__">All tasks</option>
        <option value="none">No milestone</option>
        {openMilestones.map((m) => (
          <option key={m.id} value={m.id}>
            {m.title}
          </option>
        ))}
      </select>
    </div>
  );
}
