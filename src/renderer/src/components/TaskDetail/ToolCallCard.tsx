import { useState, useMemo } from "react";
import type { ToolPart } from "@opencode-ai/sdk/v2";
import styles from "./TaskEventStream.module.css";

interface ToolCallCardProps {
  part: ToolPart;
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

export function ToolCallCard({ part }: ToolCallCardProps): React.JSX.Element {
  const state = part.state;
  const isInFlight = state.status === "pending" || state.status === "running";

  // Default: expanded while in-flight, collapsed when done
  const [isExpanded, setIsExpanded] = useState(isInFlight);
  const [outputExpanded, setOutputExpanded] = useState(false);

  const argsJson = useMemo(() => {
    try {
      return JSON.stringify(state.input, null, 2);
    } catch {
      return String(state.input);
    }
  }, [state.input]);

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
        <span className={`${styles.toolStatus} ${statusClass(state.status)}`}>
          {statusLabel(state.status)}
        </span>
        {state.status === "running" && (
          <span className={styles.spinner} />
        )}
      </div>

      {isExpanded && (
        <div className={styles.toolCallBody}>
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
