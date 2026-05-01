import { useState, useEffect } from "react";
import type { ToolPart } from "@opencode-ai/sdk/v2";
import styles from "./TaskEventStream.module.css";

function useElapsed(part: ToolPart): string {
  const state = part.state;
  const [now, setNow] = useState(() => Date.now());
  const isRunning = state?.status === "running";

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [isRunning]);

  if (state?.status === "pending") return "";
  if (state?.status === "running") {
    const ms = now - state.time.start;
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const ms = (state?.time?.end || 0) - (state?.time?.start || 0);
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

interface CompactToolRendererProps {
  part: ToolPart;
  isExpanded: boolean;
  onToggle: () => void;
}

function getOutput(part: ToolPart): string | null {
  const state = part.state;
  if (state?.status === "completed") return state.output ?? null;
  if (state?.status === "error") return state.error ?? null;
  return null;
}

function getInput(part: ToolPart): Record<string, unknown> {
  const state = part.state;
  if (state?.input && typeof state.input === "object") {
    return state.input as Record<string, unknown>;
  }
  return {};
}

export function BashRenderer({ part, isExpanded, onToggle }: CompactToolRendererProps): React.JSX.Element {
  const input = getInput(part);
  const output = getOutput(part);
  const command = (input.command as string) || "";
  const exitCode = output?.match(/exit code: (\d+)/)?.[1] || "";
  const statusMatch = output?.toLowerCase().includes("error") || output?.toLowerCase().includes("failed");
  const elapsed = useElapsed(part);
  const isError = part.state?.status === "error" || statusMatch;

  return (
    <div className={styles.compactToolCard}>
      <div className={styles.compactToolHeader} onClick={onToggle}>
        <span className={styles.compactToolIcon}>{isExpanded ? "▼" : "▶"}</span>
        <span className={styles.compactToolName}>bash</span>
        <span className={styles.compactToolSummary}>
          {command.slice(0, 60)}{command.length > 60 ? "..." : ""}
        </span>
        {elapsed && <span className={styles.toolElapsed}>{elapsed}</span>}
        {exitCode && (
          <span className={`${styles.compactToolBadge} ${isError ? styles.toolStatusError : ""}`}>
            exit {exitCode}
          </span>
        )}
      </div>
      {isExpanded && (
        <div className={styles.compactToolBody}>
          <pre className={styles.toolCommandCode}>{command}</pre>
          {output && (
            <pre className={`${styles.toolOutputCode} ${isError ? styles.toolOutputError : ""}`}>
              {output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function EditRenderer({ part, isExpanded, onToggle }: CompactToolRendererProps): React.JSX.Element {
  const input = getInput(part);
  const path = (input.path as string) || (input.file_path as string) || "unknown";
  const output = getOutput(part);
  const linesChanged = output?.match(/(\d+) lines? changed/)?.[1] || "";
  const elapsed = useElapsed(part);

  return (
    <div className={styles.compactToolCard}>
      <div className={styles.compactToolHeader} onClick={onToggle}>
        <span className={styles.compactToolIcon}>{isExpanded ? "▼" : "▶"}</span>
        <span className={styles.compactToolName}>{part.tool}</span>
        <span className={styles.compactToolSummary}>{path}</span>
        {elapsed && <span className={styles.toolElapsed}>{elapsed}</span>}
        {linesChanged && <span className={styles.compactToolBadge}>{linesChanged} lines</span>}
      </div>
      {isExpanded && (
        <div className={styles.compactToolBody}>
          <div className={styles.toolInputSection}>
            <div className={styles.toolInputLabel}>Input</div>
            <pre className={styles.toolInputCode}>{JSON.stringify(input, null, 2)}</pre>
          </div>
          {output && (
            <div className={styles.toolOutputSection}>
              <div className={styles.toolOutputLabel}>Output</div>
              <pre className={styles.toolOutputCode}>{output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function GrepRenderer({ part, isExpanded, onToggle }: CompactToolRendererProps): React.JSX.Element {
  const input = getInput(part);
  const pattern = (input.pattern as string) || "";
  const output = getOutput(part);
  const matchCount = output?.split("\n").filter(line => line.includes(":")).length || 0;
  const elapsed = useElapsed(part);

  return (
    <div className={styles.compactToolCard}>
      <div className={styles.compactToolHeader} onClick={onToggle}>
        <span className={styles.compactToolIcon}>{isExpanded ? "▼" : "▶"}</span>
        <span className={styles.compactToolName}>grep</span>
        <span className={styles.compactToolSummary}>pattern: {pattern.slice(0, 40)}</span>
        {elapsed && <span className={styles.toolElapsed}>{elapsed}</span>}
        {matchCount > 0 && <span className={styles.compactToolBadge}>{matchCount} matches</span>}
      </div>
      {isExpanded && (
        <div className={styles.compactToolBody}>
          {output ? (
            <pre className={styles.toolOutputCode}>{output}</pre>
          ) : (
            <pre className={styles.toolInputCode}>{JSON.stringify(input, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export function GlobRenderer({ part, isExpanded, onToggle }: CompactToolRendererProps): React.JSX.Element {
  const input = getInput(part);
  const pattern = (input.pattern as string) || "";
  const output = getOutput(part);
  const fileCount = output?.split("\n").filter(line => line.trim().length > 0).length || 0;
  const elapsed = useElapsed(part);

  return (
    <div className={styles.compactToolCard}>
      <div className={styles.compactToolHeader} onClick={onToggle}>
        <span className={styles.compactToolIcon}>{isExpanded ? "▼" : "▶"}</span>
        <span className={styles.compactToolName}>glob</span>
        <span className={styles.compactToolSummary}>pattern: {pattern.slice(0, 40)}</span>
        {elapsed && <span className={styles.toolElapsed}>{elapsed}</span>}
        {fileCount > 0 && <span className={styles.compactToolBadge}>{fileCount} files</span>}
      </div>
      {isExpanded && (
        <div className={styles.compactToolBody}>
          {output ? (
            <pre className={styles.toolOutputCode}>{output}</pre>
          ) : (
            <pre className={styles.toolInputCode}>{JSON.stringify(input, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export function ReadRenderer({ part, isExpanded, onToggle }: CompactToolRendererProps): React.JSX.Element {
  const input = getInput(part);
  const path = (input.path as string) || "unknown";
  const output = getOutput(part);
  const elapsed = useElapsed(part);
  const lineCount = output ? output.split("\n").length : 0;

  return (
    <div className={styles.compactToolCard}>
      <div className={styles.compactToolHeader} onClick={onToggle}>
        <span className={styles.compactToolIcon}>{isExpanded ? "▼" : "▶"}</span>
        <span className={styles.compactToolName}>read</span>
        <span className={styles.compactToolSummary}>{path}</span>
        {elapsed && <span className={styles.toolElapsed}>{elapsed}</span>}
        {output && <span className={styles.compactToolBadge}>{lineCount} lines</span>}
      </div>
      {isExpanded && (
        <div className={styles.compactToolBody}>
          <pre className={styles.toolOutputCode}>{output || JSON.stringify(input, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export function WebSearchRenderer({ part, isExpanded, onToggle }: CompactToolRendererProps): React.JSX.Element {
  const input = getInput(part);
  const query = (input.query as string) || "";
  const elapsed = useElapsed(part);

  return (
    <div className={styles.compactToolCard}>
      <div className={styles.compactToolHeader} onClick={onToggle}>
        <span className={styles.compactToolIcon}>{isExpanded ? "▼" : "▶"}</span>
        <span className={styles.compactToolName}>web_search</span>
        <span className={styles.compactToolSummary}>{query.slice(0, 50)}</span>
        {elapsed && <span className={styles.toolElapsed}>{elapsed}</span>}
      </div>
      {isExpanded && (
        <div className={styles.compactToolBody}>
          <pre className={styles.toolInputCode}>{JSON.stringify(input, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export function CompactToolRenderer({ part, isExpanded, onToggle }: CompactToolRendererProps): React.JSX.Element | null {
  const toolName = part.tool.toLowerCase();

  if (toolName === "bash" || toolName === "shell" || toolName === "terminal") {
    return <BashRenderer part={part} isExpanded={isExpanded} onToggle={onToggle} />;
  }
  if (toolName === "edit" || toolName === "apply_patch" || toolName === "multiedit" || toolName === "write") {
    return <EditRenderer part={part} isExpanded={isExpanded} onToggle={onToggle} />;
  }
  if (toolName === "grep") {
    return <GrepRenderer part={part} isExpanded={isExpanded} onToggle={onToggle} />;
  }
  if (toolName === "glob") {
    return <GlobRenderer part={part} isExpanded={isExpanded} onToggle={onToggle} />;
  }
  if (toolName === "read") {
    return <ReadRenderer part={part} isExpanded={isExpanded} onToggle={onToggle} />;
  }
  if (toolName === "web_search" || toolName === "websearch") {
    return <WebSearchRenderer part={part} isExpanded={isExpanded} onToggle={onToggle} />;
  }

  return null;
}