import { useToastStore } from "../../stores/useToastStore";
import styles from "./Toast.module.css";

export function Toast(): React.JSX.Element | null {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className={styles.stack}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`${styles.toast} ${styles[t.variant]}`}
          role="status"
          aria-live="polite"
        >
          <span className={styles.message}>{t.message}</span>
          <button
            className={styles.closeBtn}
            onClick={() => removeToast(t.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
