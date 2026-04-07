import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import styles from "./Settings.module.css";

interface WorkspaceCardGridProps {
  selectedPath: string;
  onSelect: (path: string) => void;
}

export function WorkspaceCardGrid({
  selectedPath,
  onSelect,
}: WorkspaceCardGridProps): React.JSX.Element {
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  if (workspaces.length === 0) {
    return (
      <div className={styles.workspaceEmpty}>
        <p>No workspaces configured</p>
      </div>
    );
  }

  return (
    <div className={styles.workspaceGrid}>
      {workspaces.map((ws) => {
        const isActive = ws.path === selectedPath;
        const disabled = !ws.exists;

        return (
          <button
            key={ws.path}
            className={`${styles.workspaceCard} ${isActive ? styles.workspaceCardActive : ""} ${disabled ? styles.workspaceCardDisabled : ""}`}
            onClick={() => onSelect(ws.path)}
            aria-pressed={isActive}
            aria-label={`Select workspace ${ws.name}`}
            disabled={disabled}
            title={ws.path}
          >
            <div className={styles.workspaceCardName}>{ws.name}</div>
            <div className={styles.workspaceCardPath}>
              {formatPath(ws.path)}
            </div>
            {ws.branch && (
              <div className={styles.workspaceCardBranch}>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
                </svg>
                <span>{ws.branch}</span>
              </div>
            )}
            {isActive && (
              <div className={styles.checkmark} aria-hidden="true">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M2 6L5 9L10 3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function formatPath(absolutePath: string): string {
  if (typeof process !== "undefined" && process.env?.HOME) {
    const home = process.env.HOME;
    if (absolutePath.startsWith(home)) {
      return "~" + absolutePath.slice(home.length);
    }
  }
  return absolutePath;
}
