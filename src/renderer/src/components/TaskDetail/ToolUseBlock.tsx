import { useState } from "react";
import type { MessageContentBlock } from "@shared/types";
import styles from "./PlanChat.module.css";

/** Returns a short ASCII label for a given tool name. */
function toolLabel(tool: string): string {
  switch (tool) {
    case "bash":
      return "$";
    case "read":
      return "r";
    case "write":
      return "w";
    case "edit":
      return "e";
    case "grep":
      return "/";
    case "glob":
      return "*";
    case "task":
      return "t";
    case "webfetch":
    case "websearch":
      return "~";
    default:
      return "?";
  }
}

interface ToolUseBlockProps {
  block: MessageContentBlock;
}

export function ToolUseBlock({ block }: ToolUseBlockProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { data } = block;

  if (!data) return <></>;

  const hasError = data.exitCode !== null && data.exitCode !== 0;
  const durationMs = data.time ? data.time.end - data.time.start : null;
  const durationLabel =
    durationMs !== null
      ? durationMs >= 1000
        ? `${(durationMs / 1000).toFixed(1)}s`
        : `${durationMs}ms`
      : null;

  const inputKeys = Object.keys(data.input);
  const hasOutput = data.output.length > 0;

  return (
    <div
      className={`${styles.toolUseBlock} ${hasError ? styles.toolUseError : ""}`}
    >
      <button
        className={styles.toolUseToggle}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={styles.toolUseIcon}>{toolLabel(data.tool)}</span>
        <span className={styles.toolUseName}>{data.tool}</span>
        <span className={styles.toolUseTitle}>{data.title || data.tool}</span>
        <span className={styles.toolUseMeta}>
          {hasError && (
            <span className={styles.toolUseExitBadge}>
              exit {data.exitCode}
            </span>
          )}
          {durationLabel && (
            <span className={styles.toolUseDuration}>{durationLabel}</span>
          )}
        </span>
        <span
          className={`${styles.toolUseArrow} ${open ? styles.toolUseArrowOpen : ""}`}
        >
          &#9654;
        </span>
      </button>

      {open && (
        <div className={styles.toolUseDetails}>
          {inputKeys.length > 0 && (
            <div className={styles.toolUseSection}>
              <span className={styles.toolUseSectionLabel}>input</span>
              <pre className={styles.toolUseCode}>
                {JSON.stringify(data.input, null, 2)}
              </pre>
            </div>
          )}
          {hasOutput && (
            <div className={styles.toolUseSection}>
              <span className={styles.toolUseSectionLabel}>output</span>
              <pre className={styles.toolUseCode}>{data.output}</pre>
              {data.truncated && (
                <span className={styles.toolUseTruncated}>
                  output truncated at 5KB
                </span>
              )}
            </div>
          )}
          {!hasOutput && inputKeys.length === 0 && (
            <div className={styles.toolUseEmpty}>no input or output</div>
          )}
        </div>
      )}
    </div>
  );
}
