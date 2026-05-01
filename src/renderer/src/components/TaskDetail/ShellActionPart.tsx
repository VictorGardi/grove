import { useState, useCallback, useEffect, useRef } from "react";
import styles from "./TaskEventStream.module.css";

interface ShellActionPartProps {
  command: string;
  output?: string;
  status?: string;
}

export function ShellActionPart({ command, output, status }: ShellActionPartProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    await navigator.clipboard.writeText(output || "");
    setCopied(true);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }, [output]);

  const hasOutput = output?.trim().length ?? 0 > 0;
  const isError = status === "error";

  return (
    <div className={styles.shellActionPart}>
      <div className={styles.shellActionHeader}>
        <span className={styles.shellActionIcon}>&#x24D1;</span>
        <span className={styles.shellActionLabel}>shell</span>
        {status && (
          <span className={`${styles.shellActionStatus} ${isError ? styles.shellActionStatusError : styles.shellActionStatusOk}`}>
            {status}
          </span>
        )}
      </div>

      <div className={styles.shellActionCommand}>
        <code>{command}</code>
      </div>

      {hasOutput && (
        <div className={styles.shellActionOutputSection}>
          <div className={styles.shellActionOutputHeader}>
            <button className={styles.shellActionToggle} onClick={() => setExpanded(!expanded)}>
              {expanded ? "Hide output" : "Show output"}
            </button>
            <button className={styles.shellActionCopy} onClick={handleCopy}>
              {copied ? "copied" : "copy"}
            </button>
          </div>
          {expanded && (
            <pre className={`${styles.shellActionOutput} ${isError ? styles.shellActionOutputError : ""}`}>
              {output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}