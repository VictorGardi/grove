import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BusyDots } from "./BusyDots";
import styles from "./TaskEventStream.module.css";

const THROTTLE_MS = 100;

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

interface StreamingReasoningProps {
  text: string;
  isStreaming: boolean;
  startTime?: number;
}

export function StreamingReasoning({
  text,
  isStreaming,
  startTime,
}: StreamingReasoningProps): React.JSX.Element {
  const [throttledText, setThrottledText] = useState(text);
  const pendingRef = useRef(text);
  const [now, setNow] = useState(Date.now());

  // Throttle text updates while streaming
  useEffect(() => {
    if (!isStreaming) {
      setThrottledText(text);
      return;
    }

    pendingRef.current = text;
    setThrottledText(text);

    const interval = setInterval(() => {
      setThrottledText((prev) => {
        if (pendingRef.current !== prev) {
          return pendingRef.current;
        }
        return prev;
      });
    }, THROTTLE_MS);

    return () => clearInterval(interval);
  }, [text, isStreaming]);

  // Live timer for streaming duration
  useEffect(() => {
    if (!isStreaming || !startTime) {
      setNow(Date.now());
      return;
    }

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => clearInterval(interval);
  }, [isStreaming, startTime]);

  const liveDuration =
    isStreaming && startTime ? formatDuration(now - startTime) : null;

  // Show "Thinking..." placeholder when streaming but no text yet
  if (isStreaming && !text.trim()) {
    return (
      <div className={`${styles.reasoningPart} ${styles.reasoningPartStreaming}`}>
        <span className={styles.reasoningThinking}>
          Thinking<BusyDots />
        </span>
      </div>
    );
  }

  return (
    <div
      className={`${styles.reasoningPart} ${isStreaming ? styles.reasoningPartStreaming : ""}`}
    >
      <details open={isStreaming}>
        <summary className={styles.reasoningSummary}>
          <span>Reasoning</span>
          {liveDuration && (
            <span className={styles.reasoningLiveTimer}>{liveDuration}</span>
          )}
        </summary>
        <div className={styles.reasoningText}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{throttledText}</ReactMarkdown>
        </div>
      </details>
    </div>
  );
}
