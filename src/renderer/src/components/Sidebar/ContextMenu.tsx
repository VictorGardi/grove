import { useEffect, useRef } from "react";

interface ContextMenuProps {
  x: number;
  y: number;
  workspaceName: string;
  onRemove: () => void;
  onClose: () => void;
}

export function ContextMenu({
  x,
  y,
  workspaceName,
  onRemove,
  onClose,
}: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const menuWidth = 180;
  const menuHeight = 80;
  const adjustedX = x + menuWidth > window.innerWidth ? x - menuWidth : x;
  const adjustedY = y + menuHeight > window.innerHeight ? y - menuHeight : y;

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: adjustedY,
        left: adjustedX,
        zIndex: 1000,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        minWidth: `${menuWidth}px`,
        overflow: "hidden",
        padding: "4px 0",
      }}
    >
      <div
        style={{
          padding: "4px 12px",
          fontSize: "11px",
          color: "var(--text-lo)",
          fontFamily: "var(--font-ui)",
          borderBottom: "1px solid var(--border)",
          marginBottom: "4px",
        }}
      >
        {workspaceName}
      </div>
      <button
        onClick={onRemove}
        style={{
          display: "block",
          width: "100%",
          padding: "6px 12px",
          background: "transparent",
          border: "none",
          color: "var(--status-red)",
          fontFamily: "var(--font-ui)",
          fontSize: "13px",
          textAlign: "left",
          cursor: "pointer",
          transition: "background var(--transition-fast)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            "transparent";
        }}
      >
        Remove workspace
      </button>
    </div>
  );
}
