import { useNavStore, type View } from "../../stores/useNavStore";

interface NavItem {
  id: View | "terminal";
  label: string;
  icon: React.JSX.Element;
  bottom?: boolean;
}

const navItems: NavItem[] = [
  {
    id: "board",
    label: "Task Board",
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
    id: "settings",
    label: "Settings",
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
  const activeView = useNavStore((s) => s.activeView);
  const setActiveView = useNavStore((s) => s.setActiveView);
  const terminalPanelOpen = useNavStore((s) => s.terminalPanelOpen);
  const toggleTerminalPanel = useNavStore((s) => s.toggleTerminalPanel);

  function renderItem(item: NavItem): React.JSX.Element {
    const isTerminal = item.id === "terminal";
    const isActive = isTerminal ? terminalPanelOpen : activeView === item.id;

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

    return (
      <div
        key={item.id}
        role="button"
        tabIndex={0}
        aria-label={item.label}
        aria-pressed={isActive}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 16px",
          cursor: "pointer",
          background: isActive ? "var(--bg-active)" : "transparent",
          color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
          fontFamily: "var(--font-ui)",
          fontSize: "13px",
          transition:
            "background var(--transition-fast), color var(--transition-fast)",
          outline: "none",
        }}
        onMouseEnter={(e) => {
          if (!isActive) {
            (e.currentTarget as HTMLDivElement).style.background =
              "var(--bg-hover)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            (e.currentTarget as HTMLDivElement).style.background =
              "transparent";
          }
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
        {item.label}
      </div>
    );
  }

  const topItems = navItems.filter((item) => !item.bottom);
  const bottomItems = navItems.filter((item) => item.bottom);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div>{topItems.map(renderItem)}</div>
      <div style={{ marginTop: "auto" }}>{bottomItems.map(renderItem)}</div>
    </div>
  );
}
