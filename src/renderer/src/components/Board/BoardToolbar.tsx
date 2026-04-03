import { createTask } from "../../actions/taskActions";
import styles from "./BoardToolbar.module.css";

export function BoardToolbar(): React.JSX.Element {
  function handleNewTask(): void {
    createTask("New task");
  }

  return (
    <div className={styles.toolbar}>
      <button className={styles.newTaskBtn} onClick={handleNewTask}>
        + New task
      </button>
    </div>
  );
}
