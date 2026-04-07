import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  title?: string;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({
  x,
  y,
  title,
  items,
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

  const menuWidth = 180;
  const menuHeight = 80 + items.length * 30;
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
      {title && (
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
          {title}
        </div>
      )}
      {items.map((item, index) => (
        <button
          key={index}
          onClick={item.disabled ? undefined : item.onClick}
          disabled={item.disabled}
          style={{
            display: "block",
            width: "100%",
            padding: "6px 12px",
            background: "transparent",
            border: "none",
            color: item.destructive
              ? "var(--status-red)"
              : "var(--text-primary)",
            fontFamily: "var(--font-ui)",
            fontSize: "13px",
            textAlign: "left",
            cursor: item.disabled ? "not-allowed" : "pointer",
            opacity: item.disabled ? 0.4 : 1,
            transition: "background var(--transition-fast)",
          }}
          onMouseEnter={(e) => {
            if (!item.disabled) {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--bg-hover)";
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "transparent";
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
