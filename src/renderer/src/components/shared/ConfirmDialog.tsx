import { createPortal } from "react-dom";
import { useDialogStore } from "../../stores/useDialogStore";
import styles from "./ConfirmDialog.module.css";

export function ConfirmDialog(): React.JSX.Element | null {
  const open = useDialogStore((s) => s.open);
  const options = useDialogStore((s) => s.options);
  const confirm = useDialogStore((s) => s.confirm);
  const cancel = useDialogStore((s) => s.cancel);

  if (!open || !options) return null;

  return createPortal(
    <div className={styles.backdrop} onClick={cancel}>
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <h2 id="dialog-title" className={styles.title}>
          {options.title}
        </h2>
        <p className={styles.message}>{options.message}</p>
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={cancel}>
            {options.cancelLabel}
          </button>
          <button className={styles.confirmBtn} onClick={confirm}>
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
