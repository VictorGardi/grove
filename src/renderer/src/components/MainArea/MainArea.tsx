import styles from "./MainArea.module.css";
import { useNavStore } from "../../stores/useNavStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useDataStore } from "../../stores/useDataStore";
import { Board } from "../Board/Board";
import { TaskDetailPanel } from "../TaskDetail/TaskDetailPanel";
import { FilesView } from "../Files/FilesView";

export function MainArea(): React.JSX.Element {
  const activeView = useNavStore((s) => s.activeView);
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const selectedTaskId = useDataStore((s) => s.selectedTaskId);

  if (!activeWorkspacePath) {
    return (
      <div className={styles.mainArea}>
        <div className={styles.placeholder}>
          <svg
            width="32"
            height="32"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ color: "var(--text-lo)", marginBottom: "12px" }}
          >
            <path
              d="M8 14V8M8 8C8 5.5 6 3 3 3C3 6 5 8 8 8ZM8 8C8 5.5 10 3 13 3C13 6 11 8 8 8Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M6 14H10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <div className={styles.placeholderText}>
            Add a workspace to get started
          </div>
          <button className={styles.addButton} onClick={addWorkspace}>
            Add workspace
          </button>
        </div>
      </div>
    );
  }

  if (activeView === "board") {
    return (
      <div className={styles.mainAreaContent}>
        <Board />
        {selectedTaskId && <TaskDetailPanel />}
      </div>
    );
  }

  if (activeView === "files") {
    return (
      <div className={styles.mainAreaContent}>
        <FilesView />
      </div>
    );
  }

  // Decisions placeholder — coming in Phase 9
  return (
    <div className={styles.mainArea}>
      <div className={styles.placeholder}>
        <svg
          width="28"
          height="28"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ color: "var(--text-lo)", marginBottom: "12px" }}
        >
          <path
            d="M3 2H13C13.55 2 14 2.45 14 3V13C14 13.55 13.55 14 13 14H3C2.45 14 2 13.55 2 13V3C2 2.45 2.45 2 3 2Z"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path
            d="M5 5.5H11M5 8H11M5 10.5H8"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        <div className={styles.placeholderText}>
          Decisions — coming in Phase 9
        </div>
      </div>
    </div>
  );
}
