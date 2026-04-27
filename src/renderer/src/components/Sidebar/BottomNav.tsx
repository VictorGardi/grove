import { useState, useEffect } from "react";
import { useNavStore, type View } from "../../stores/useNavStore";
import { useAgentsStore } from "../../stores/useAgentsStore";

const STORAGE_KEY = "grove:nav-expanded";

function getInitialExpanded(): boolean {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) return stored === "true";
  return false;
}

function usePersistentExpanded(): [boolean, (value: boolean) => void] {
  const [expanded, setExpanded] = useState<boolean>(getInitialExpanded);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(expanded));
  }, [expanded]);

  return [expanded, setExpanded];
}

interface NavItem {
  id: View | "terminal";
  label: string;
  icon: React.JSX.Element;
  alwaysVisible?: boolean;
  bottom?: boolean;
  badge?: number;
}

const navItems: NavItem[] = [
  {
    id: "board",
    label: "Task Board",
    alwaysVisible: true,
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect
          x="1"
          y="1"
          width="6"
          height="6"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <rect
          x="9"
          y="1"
          width="6"
          height="6"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <rect
          x="1"
          y="9"
          width="6"
          height="6"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <rect
          x="9"
          y="9"
          width="6"
          height="6"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.3"
        />
      </svg>
    ),
  },
  {
    id: "files",
    label: "Files",
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M2 2.5C2 1.95 2.45 1.5 3 1.5H7L9 3.5H13C13.55 3.5 14 3.95 14 4.5V12.5C14 13.05 13.55 13.5 13 13.5H3C2.45 13.5 2 13.05 2 12.5V2.5Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "decisions",
    label: "Decisions",
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
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
    ),
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M2 3H14C14.55 3 15 3.45 15 4V12C15 12.55 14.55 13 14 13H2C1.45 13 1 12.55 1 12V4C1 3.45 1.45 3 2 3Z"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path
          d="M4.5 6L7 8L4.5 10"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8.5 10H11.5"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "agents",
    label: "Agents",
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="8" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M2 13C2 11 4.5 10 8 10C11.5 10 14 11 14 13"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    alwaysVisible: true,
    bottom: true,
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M8 1.5V3M8 13V14.5M14.5 8H13M3 8H1.5M12.7 3.3L11.6 4.4M4.4 11.6L3.3 12.7M12.7 12.7L11.6 11.6M4.4 4.4L3.3 3.3"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

export function BottomNav(): React.JSX.Element {
  const [expanded, setExpanded] = usePersistentExpanded();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const activeView = useNavStore((s) => s.activeView);
  const setActiveView = useNavStore((s) => s.setActiveView);
  const terminalPanelOpen = useNavStore((s) => s.terminalPanelOpen);
  const toggleTerminalPanel = useNavStore((s) => s.toggleTerminalPanel);
  const runningSessionCount = useAgentsStore((s) => s.runningCount);

  function renderItem(
    item: NavItem,
    isCollapsed: boolean
  ): React.JSX.Element {
    const isTerminal = item.id === "terminal";
    const isActive = isTerminal ? terminalPanelOpen : activeView === item.id;
    const showBadge =
      item.id === "agents" &&
      runningSessionCount > 0 &&
      !(isCollapsed && !item.alwaysVisible);

    function handleClick(): void {
      if (isTerminal) {
        toggleTerminalPanel();
      } else {
        setActiveView(item.id as View);
      }
    }

    function handleKeyDown(e: React.KeyboardEvent): void {
      if (e.key === "Enter" || e.key === " ") handleClick();
    }

    const showLabel =
      item.alwaysVisible || expanded || hoveredId === item.id;

    return (
      <div
        key={item.id}
        role="button"
        tabIndex={0}
        aria-label={item.label}
        aria-pressed={isActive}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => item.alwaysVisible && setHoveredId(item.id)}
        onMouseLeave={() => item.alwaysVisible && setHoveredId(null)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 16px",
          cursor: "pointer",
          background: isActive
            ? "var(--bg-active)"
            : item.alwaysVisible && hoveredId === item.id
            ? "var(--bg-hover)"
            : "transparent",
          color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
          fontFamily: "var(--font-ui)",
          fontSize: "13px",
          transition:
            "background var(--transition-fast), color var(--transition-fast)",
          outline: "none",
          position: "relative",
        }}
      >
        <span
          style={{
            color: isActive ? "var(--text-secondary)" : "var(--text-lo)",
            display: "flex",
          }}
        >
          {item.icon}
        </span>
        {showLabel && item.label}
        {showBadge && (
          <div
            style={{
              marginLeft: "auto",
              background: "var(--color-red)",
              color: "white",
              borderRadius: "50%",
              width: "20px",
              height: "20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "11px",
              fontWeight: "600",
            }}
          >
            {runningSessionCount > 9 ? "9+" : runningSessionCount}
          </div>
        )}
      </div>
    );
  }

  const topAlwaysVisibleItems = navItems.filter(
    (item) => item.alwaysVisible && !item.bottom
  );
  const bottomAlwaysVisibleItems = navItems.filter(
    (item) => item.alwaysVisible && item.bottom
  );
  const collapsibleItems = navItems.filter(
    (item) => !item.alwaysVisible
  );

  const ExpandIcon = expanded ? (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
      <path
        d="M4 6L8 10L12 6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
      <path
        d="M4 10L8 6L12 10"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={expanded ? "Collapse nav" : "Expand nav"}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setExpanded(!expanded);
        }}
        onMouseEnter={() => setHoveredId("more")}
        onMouseLeave={() => setHoveredId(null)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "8px 16px",
          cursor: "pointer",
          background:
            hoveredId === "more" ? "var(--bg-hover)" : "transparent",
          color: "var(--text-secondary)",
          fontFamily: "var(--font-ui)",
          fontSize: "10px",
          transition: "background var(--transition-fast)",
          outline: "none",
        }}
      >
        {ExpandIcon}
      </div>
      {expanded && (
        <div>{collapsibleItems.map((item) => renderItem(item, false))}</div>
      )}
      <div>
        {topAlwaysVisibleItems.map((item) => renderItem(item, !expanded))}
      </div>
      <div>
        {bottomAlwaysVisibleItems.map((item) => renderItem(item, !expanded))}
      </div>
    </div>
  );
}
