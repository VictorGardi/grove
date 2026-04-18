import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import { useShortcutsModalStore } from "../../stores/useShortcutsModalStore";
import styles from "./ShortcutsModal.module.css";

interface Shortcut {
  key: string;
  action: string;
}

interface ShortcutSection {
  title: string;
  shortcuts: Shortcut[];
}

const shortcutSections: ShortcutSection[] = [
  {
    title: "Global",
    shortcuts: [
      { key: "⌘ P", action: "Open file search" },
      { key: "⌘ K", action: "Navigate to board and focus search" },
      { key: "⌘ E", action: "Switch to previous task" },
      { key: "⌘ ,", action: "Open settings" },
      { key: "⌘ B", action: "Toggle sidebar" },
      { key: "⌘ J", action: "Toggle terminal panel" },
      { key: "⌃ `", action: "Toggle terminal panel" },
      { key: "`", action: "Toggle terminal panel (when not in xterm)" },
      { key: "⌘ N", action: "Add new workspace" },
      { key: "⌘ 1–9", action: "Switch to workspace 1–9" },
    ],
  },
  {
    title: "Board View",
    shortcuts: [
      { key: "?", action: "Activate search on board" },
      { key: "⌘ T", action: "Create new task" },
      { key: "N", action: "Create new task" },
      { key: "Enter", action: "Open focused task" },
      { key: "↑/↓", action: "Navigate tasks" },
      { key: "←/→", action: "Move between columns" },
      { key: "Escape", action: "Clear search / close task detail" },
    ],
  },
];

export function ShortcutsModal(): React.JSX.Element | null {
  const open = useShortcutsModalStore((s) => s.open);
  const closeModal = useShortcutsModalStore((s) => s.closeModal);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, closeModal]);

  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className={styles.backdrop} onClick={closeModal}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        tabIndex={-1}
      >
        <h2 id="shortcuts-title" className={styles.title}>
          Keyboard Shortcuts
        </h2>
        {shortcutSections.map((section) => (
          <div key={section.title}>
            <div className={styles.sectionTitle}>{section.title}</div>
            <table className={styles.table}>
              <tbody>
                {section.shortcuts.map((shortcut) => (
                  <tr key={shortcut.key} className={styles.row}>
                    <td className={styles.shortcut}>{shortcut.key}</td>
                    <td className={styles.action}>{shortcut.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <div className={styles.hint}>Press Escape to close</div>
      </div>
    </div>,
    document.body,
  );
}
