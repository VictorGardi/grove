import styles from "./Sidebar.module.css";
import { AppWordmark } from "./AppWordmark";
import { WorkspaceList } from "./WorkspaceList";
import { WorktreeList } from "./WorktreeList";
import { BottomNav } from "./BottomNav";

export function Sidebar(): React.JSX.Element {
  return (
    <div className={styles.sidebar}>
      <AppWordmark />

      <div className={styles.workspaceListArea}>
        <div
          className={styles.sectionLabel}
          style={{ padding: "8px 16px 4px" }}
        >
          Workspaces
        </div>
        <WorkspaceList />
      </div>

      <div className={styles.worktreeListArea}>
        <WorktreeList />
      </div>

      <div className={styles.bottomSection}>
        <BottomNav />
      </div>
    </div>
  );
}
