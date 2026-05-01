import { useState, useMemo, useEffect } from "react";
import type { ToolPart } from "@opencode-ai/sdk/v2";
import { useChatContext } from "./ChatContext";
import styles from "./TaskEventStream.module.css";

interface ToolCallCardProps {
  part: ToolPart;
  defaultExpanded?: boolean;
}

const TRUNCATE_LENGTH = 2000;

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "pending";
    case "running":
      return "running…";
    case "completed":
      return "done";
    case "error":
      return "error";
    default:
      return status;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "running":
      return styles.toolStatusRunning;
    case "completed":
      return styles.toolStatusCompleted;
    case "error":
      return styles.toolStatusError;
    default:
      return styles.toolStatusPending;
  }
}

function useElapsed(state: ToolPart["state"]): string {
  const { isBusy } = useChatContext();
  const [now, setNow] = useState(() => Date.now());
  const isRunning = isBusy && state.status === "running";

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [isRunning]);

  if (state.status === "pending") return "";
  if (state.status === "running") {
    const ms = now - state.time.start;
    return `${(ms / 1000).toFixed(1)}s`;
  }
  // completed or error — static value
  const ms = state.time.end - state.time.start;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function ToolCallCard({ part, defaultExpanded }: ToolCallCardProps): React.JSX.Element {
  const state = part.state;

  // Default: collapsed (like openchamber) - no auto-expand
  const [isExpanded, setIsExpanded] = useState(defaultExpanded ?? false);
  const [outputExpanded, setOutputExpanded] = useState(false);
  const elapsed = useElapsed(state);

  const argsJson = useMemo(() => {
    try {
      return JSON.stringify(state.input, null, 2);
    } catch {
      return String(state.input);
    }
  }, [state.input]);

  // Compact preview for collapsed state (Phase 1)
  const compactPreview = useMemo(() => {
    if (!state.input) return "";
    try {
      const input = state.input as Record<string, unknown>;
      // Extract meaningful preview based on tool type
      if (part.tool === "edit" || part.tool === "apply_patch") {
        const path = input.path || input.file_path || input.filename || "";
        return String(path);
      }
      if (part.tool === "bash" || part.tool === "shell") {
        const cmd = input.command || input.cmd || "";
        return String(cmd).slice(0, 60);
      }
      if (part.tool === "read") {
        const path = input.path || "";
        return String(path);
      }
      if (part.tool === "grep") {
        const pattern = input.pattern || "";
        return `pattern: ${String(pattern).slice(0, 40)}`;
      }
      if (part.tool === "glob") {
        const pattern = input.pattern || "";
        return `pattern: ${String(pattern).slice(0, 40)}`;
      }
      // Default: first value or key
      const keys = Object.keys(input);
      if (keys.length > 0) {
        const firstVal = input[keys[0]];
        return `${keys[0]}: ${String(firstVal).slice(0, 40)}`;
      }
    } catch {
      // ignore
    }
    return "";
  }, [part.tool, state.input]);

  const output =
    state.status === "completed"
      ? state.output
      : state.status === "error"
        ? state.error
        : null;

  const outputTruncated =
    output !== null && output.length > TRUNCATE_LENGTH && !outputExpanded
      ? output.slice(0, TRUNCATE_LENGTH) + "\n… [truncated]"
      : output;

  const needsShowMore =
    output !== null && output.length > TRUNCATE_LENGTH && !outputExpanded;

  return (
    <div className={styles.toolCallCard}>
      <div
        className={styles.toolCallHeader}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span
          className={`${styles.toolCallIcon} ${isExpanded ? styles.toolCallIconExpanded : ""}`}
        >
          ▶
        </span>
        <span className={styles.toolCallName}>{part.tool}</span>
        {!isExpanded && compactPreview && (
          <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, flex: 1, minWidth: 0 }}>
            {compactPreview}
          </span>
        )}
        {elapsed && (
          <span className={styles.toolElapsed}>{elapsed}</span>
        )}
        <span className={`${styles.toolStatus} ${statusClass(state.status)}`}>
          {statusLabel(state.status)}
        </span>
        {state.status === "running" && (
          <span className={styles.spinner} />
        )}
      </div>

      {isExpanded && (
        <div className={`${styles.toolCallBody} ${styles.toolCallBodyExpanded}`}>
          {/* Args */}
          <div className={styles.toolCallArgs}>
            <pre>{argsJson}</pre>
          </div>

          {/* Output / Error */}
          {output !== null && (
            <div
              className={
                state.status === "error"
                  ? styles.toolCallError
                  : styles.toolCallOutput
              }
            >
              <pre>{outputTruncated}</pre>
              {needsShowMore && (
                <button
                  className={styles.showMoreButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOutputExpanded(true);
                  }}
                >
                  Show more ({output.length.toLocaleString()} chars)
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
