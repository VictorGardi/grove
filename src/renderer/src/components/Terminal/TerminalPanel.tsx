import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./TerminalPanel.module.css";
import { TerminalTabView } from "./TerminalTab";
import { useTerminalStore } from "../../stores/useTerminalStore";
import {
  initTerminalListeners,
  cleanupTerminalListeners,
  getXterm,
} from "../../stores/useTerminalStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";

const DEFAULT_HEIGHT = 240;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const LS_KEY = "grove:terminal-panel-height";

function getStoredHeight(): number {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v) {
      const n = parseInt(v, 10);
      if (n >= MIN_HEIGHT && n <= MAX_HEIGHT) return n;
    }
  } catch {
    // ignore
  }
  return DEFAULT_HEIGHT;
}

export function TerminalPanel({
  visible,
}: {
  visible: boolean;
}): React.JSX.Element {
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const idleMap = useTerminalStore((s) => s.idleMap);
  const deadSet = useTerminalStore((s) => s.deadSet);
  const addTab = useTerminalStore((s) => s.addTab);
  const removeTab = useTerminalStore((s) => s.removeTab);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);

  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);

  const [height, setHeight] = useState(getStoredHeight);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  // Initialize centralized terminal listeners on mount
  useEffect(() => {
    initTerminalListeners();
    return () => {
      cleanupTerminalListeners();
    };
  }, []);

  // Focus the active terminal whenever the panel becomes visible
  useEffect(() => {
    if (visible && activeTabId) {
      // Small delay — DOM needs to go from display:none to display:flex first
      setTimeout(() => getXterm(activeTabId)?.focus(), 20);
    }
  }, [visible, activeTabId]);

  // Preserve hidden tabs when panel is hidden (don't destroy PTY)
  const prevVisible = useRef(visible);
  useEffect(() => {
    if (!visible && prevVisible.current) {
      // Panel just became hidden - preserve tabs
      tabs.forEach((tab) => {
        useTerminalStore.getState().removeTab(tab.id, true);
      });
    }
    prevVisible.current = visible;
  }, [visible]);

  // Persist height to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, String(height));
    } catch {
      // ignore
    }
  }, [height]);

  // Filter tabs for current workspace - memoized to avoid re-filtering on every render
  const workspaceTabs = useMemo(() => {
    if (!activeWorkspacePath) return [];
    return tabs.filter((t) => t.workspacePath === activeWorkspacePath);
  }, [tabs, activeWorkspacePath]);

  // Resize handle drag
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      dragStartY.current = e.clientY;
      dragStartHeight.current = height;
    },
    [height],
  );

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent): void => {
      const delta = dragStartY.current - e.clientY;
      const newHeight = Math.min(
        MAX_HEIGHT,
        Math.max(MIN_HEIGHT, dragStartHeight.current + delta),
      );
      setHeight(newHeight);
    };

    const onMouseUp = (): void => {
      setDragging(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging]);

  // Add a free terminal at workspace root
  const handleAddTab = useCallback(async () => {
    if (!activeWorkspacePath) return;
    const id = `free-${Date.now()}`;

    // Create PTY before adding the tab so it exists when TerminalTabView mounts
    const result = await window.api.pty.create(id, activeWorkspacePath);
    if (!result.ok) {
      console.error("[TerminalPanel] PTY create failed:", result.error);
      // Add the tab anyway — user can press a key to restart
    }

    addTab({
      id,
      label: "Terminal",
      workspacePath: activeWorkspacePath,
      worktreePath: null,
      taskId: null,
    });
  }, [activeWorkspacePath, addTab]);

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      style={{ height: `${height}px`, display: visible ? "flex" : "none" }}
    >
      {/* Resize handle */}
      <div
        className={`${styles.resizeHandle} ${dragging ? styles.dragging : ""}`}
        onMouseDown={onMouseDown}
      />

      {/* Tab bar */}
      <div className={styles.tabBar}>
        {workspaceTabs.map((tab) => {
          const isDead = deadSet[tab.id] === true;
          const isActive = !isDead && idleMap[tab.id] === false;
          return (
            <button
              key={tab.id}
              className={`${styles.tab} ${tab.id === activeTabId ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span
                className={`${styles.dot} ${isDead ? styles.dotDead : isActive ? styles.dotActive : styles.dotIdle}`}
              />
              {tab.label}
              <span
                className={styles.tabClose}
                onClick={(e) => {
                  e.stopPropagation();
                  removeTab(tab.id);
                }}
              >
                &times;
              </span>
            </button>
          );
        })}
        <button
          className={styles.addTab}
          onClick={handleAddTab}
          title="New terminal"
        >
          +
        </button>
      </div>

      {/* Terminal content */}
      <div className={styles.content}>
        {workspaceTabs.map((tab) => (
          <TerminalTabView
            key={tab.id}
            id={tab.id}
            cwd={tab.worktreePath ?? tab.workspacePath}
            visible={tab.id === activeTabId}
          />
        ))}
      </div>
    </div>
  );
}
