import { useState, useCallback } from "react";
import styles from "./TaskEventStream.module.css";

interface DiffLine {
  type: "context" | "added" | "removed";
  lineNumber: number | null;
  content: string;
}

interface DiffHunk {
  file: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

interface DiffViewerProps {
  diffText: string;
  filePath?: string;
}

function parseDiff(text: string): DiffHunk[] {
  const lines = text.split("\n");
  const hunks: DiffHunk[] = [];
  let currentFile = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("Index:") || line.startsWith("===") || line.startsWith("---") || line.startsWith("+++")) {
      if (line.startsWith("Index:")) {
        const parts = line.split(" ");
        currentFile = parts.length > 1 ? parts.slice(1).join(" ").split("/").pop() || "file" : "file";
      }
      i++;
      continue;
    }

    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      const oldStart = match ? parseInt(match[1], 10) : 0;
      const newStart = match ? parseInt(match[2], 10) : 0;

      const diffLines: DiffLine[] = [];
      let oldLineNum = oldStart;
      let newLineNum = newStart;
      let j = i + 1;

      while (j < lines.length && !lines[j].startsWith("@@") && !lines[j].startsWith("Index:") && !lines[j].startsWith("===")) {
        const contentLine = lines[j];
        if (contentLine.startsWith("+")) {
          diffLines.push({ type: "added", lineNumber: newLineNum, content: contentLine.substring(1) });
          newLineNum++;
        } else if (contentLine.startsWith("-")) {
          diffLines.push({ type: "removed", lineNumber: oldLineNum, content: contentLine.substring(1) });
          oldLineNum++;
        } else if (contentLine.startsWith(" ") || contentLine.trim() === "") {
          diffLines.push({ type: "context", lineNumber: newLineNum, content: contentLine.substring(1) });
          oldLineNum++;
          newLineNum++;
        }
        j++;
      }

      hunks.push({ file: currentFile, oldStart, newStart, lines: diffLines });
      i = j;
      continue;
    }

    i++;
  }

  return hunks;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function DiffViewer({ diffText, filePath }: DiffViewerProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const hunks = parseDiff(diffText);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(diffText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [diffText]);

  const stats = hunks.reduce(
    (acc, hunk) => {
      hunk.lines.forEach((line) => {
        if (line.type === "added") acc.added++;
        else if (line.type === "removed") acc.removed++;
      });
      return acc;
    },
    { added: 0, removed: 0 }
  );

  const displayLines = isExpanded ? hunks : hunks.slice(0, 1);
  const hasMore = hunks.length > 1;

  return (
    <div className={styles.diffViewer}>
      <div className={styles.diffHeader} onClick={() => setIsExpanded(!isExpanded)}>
        <span className={styles.diffIcon}>{isExpanded ? "▼" : "▶"}</span>
        <span className={styles.diffFilePath}>{filePath || hunks[0]?.file || "file"}</span>
        <span className={styles.diffStats}>
          <span className={styles.diffAdded}>+{stats.added}</span>
          <span className={styles.diffRemoved}>-{stats.removed}</span>
        </span>
        {hunks.length > 1 && (
          <span className={styles.diffHunkCount}>{hunks.length} hunk{hunks.length !== 1 ? "s" : ""}</span>
        )}
        <button
          className={styles.diffCopyBtn}
          onClick={(e) => {
            e.stopPropagation();
            handleCopy();
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>

      {isExpanded && (
        <div className={styles.diffBody}>
          {displayLines.map((hunk, hunkIdx) => (
            <div key={hunkIdx} className={styles.diffHunk}>
              <div className={styles.diffHunkHeader}>@@ -{hunk.oldStart} +{hunk.newStart} @@</div>
              {hunk.lines.map((line, lineIdx) => (
                <div
                  key={lineIdx}
                  className={`${styles.diffLine} ${line.type === "added" ? styles.diffLineAdded : line.type === "removed" ? styles.diffLineRemoved : ""}`}
                >
                  <span className={styles.diffLineNum}>
                    {line.lineNumber !== null ? line.lineNumber : ""}
                  </span>
                  <span className={styles.diffLineMarker}>
                    {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                  </span>
                  <span className={styles.diffLineContent}>{line.content}</span>
                </div>
              ))}
            </div>
          ))}
          {!isExpanded && hasMore && (
            <button className={styles.diffShowMore} onClick={() => setIsExpanded(true)}>
              Show {hunks.length - 1} more hunk{hunks.length - 1 !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export { formatDuration };