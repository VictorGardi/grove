import { useShortcutsModalStore } from "../../stores/useShortcutsModalStore";

export function HelpButton(): React.JSX.Element {
  const toggleModal = useShortcutsModalStore((s) => s.toggleModal);

  return (
    <button
      onClick={toggleModal}
      aria-label="Keyboard shortcuts"
      style={{
        position: "fixed",
        bottom: "16px",
        right: "16px",
        width: "28px",
        height: "28px",
        borderRadius: "50%",
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        color: "var(--text-secondary)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-ui)",
        fontSize: "14px",
        fontWeight: 500,
        zIndex: 100,
        transition:
          "background var(--transition-fast), color var(--transition-fast)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          "var(--bg-hover)";
        (e.currentTarget as HTMLButtonElement).style.color =
          "var(--text-primary)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          "var(--bg-elevated)";
        (e.currentTarget as HTMLButtonElement).style.color =
          "var(--text-secondary)";
      }}
    >
      ?
    </button>
  );
}
