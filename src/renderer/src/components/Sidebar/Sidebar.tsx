import styles from "./Sidebar.module.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppWordmark } from "./AppWordmark";
import { WorkspaceItem } from "./WorkspaceItem";
import { WorkspaceTaskList } from "./WorkspaceTaskList";
import { WorktreeList } from "./WorktreeList";
import { BottomNav } from "./BottomNav";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";

const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const LS_KEY = "grove:sidebar-width";

function getStoredWidth(): number {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v) {
      const n = parseInt(v, 10);
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
  } catch {
    // ignore
  }
  return DEFAULT_WIDTH;
}

export function Sidebar(): React.JSX.Element {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(
    activeWorkspacePath ? new Set([activeWorkspacePath]) : new Set(),
  );
  const [width, setWidth] = useState(getStoredWidth);
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  function toggleExpanded(workspacePath: string): void {
    setActiveWorkspace(workspacePath);
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspacePath)) {
        next.delete(workspacePath);
      } else {
        next.add(workspacePath);
      }
      return next;
    });
  }

  // Auto-expand the active workspace when it changes
  useEffect(() => {
    if (activeWorkspacePath) {
      setExpandedWorkspaces((prev) => {
        if (prev.has(activeWorkspacePath)) return prev;
        const next = new Set(prev);
        next.add(activeWorkspacePath);
        return next;
      });
    }
  }, [activeWorkspacePath]);

  // Persist width to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, String(width));
    } catch {
      // ignore
    }
  }, [width]);

  // Resize handle drag
  const onResizeHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      document.body.style.cursor = "col-resize";
      dragStartX.current = e.clientX;
      dragStartWidth.current = width;
    },
    [width],
  );

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent): void => {
      const delta = e.clientX - dragStartX.current;
      const newWidth = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, dragStartWidth.current + delta),
      );
      setWidth(newWidth);
    };

    const onMouseUp = (): void => {
      setDragging(false);
      document.body.style.cursor = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging]);

  return (
    <div className={styles.sidebar} style={{ width: `${width}px` }}>
      {/* Resize handle */}
      <div
        className={styles.resizeHandle}
        onMouseDown={onResizeHandleMouseDown}
      />

      <AppWordmark />

      <div className={styles.workspaceListArea}>
        <div className={styles.sectionLabel}>
          <span>Workspaces</span>
        </div>
        {workspaces.map((workspace) => {
          const isExpanded = expandedWorkspaces.has(workspace.path);
          return (
            <div key={workspace.path}>
              <WorkspaceItem
                workspace={workspace}
                isActive={workspace.path === activeWorkspacePath}
                isExpanded={isExpanded}
                onClick={() => toggleExpanded(workspace.path)}
              />
              {isExpanded && (
                <WorkspaceTaskList
                  workspacePath={workspace.path}
                  workspaceName={workspace.name}
                />
              )}
            </div>
          );
        })}
        <button
          onClick={addWorkspace}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            width: "100%",
            padding: "6px 16px",
            background: "transparent",
            border: "none",
            color: "var(--text-lo)",
            fontFamily: "var(--font-ui)",
            fontSize: "12px",
            cursor: "pointer",
            textAlign: "left",
            transition: "color var(--transition-fast)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--text-lo)";
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ color: "currentColor", flexShrink: 0 }}
          >
            <path
              d="M8 3V13M3 8H13"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          Add workspace
        </button>
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
