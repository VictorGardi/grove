import { useState, useEffect, useCallback, useRef } from "react";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useTerminalStore } from "../../stores/useTerminalStore";
import { useNavStore } from "../../stores/useNavStore";
import { useFileStore } from "../../stores/useFileStore";
import type { TaskInfo, DiffSummary } from "@shared/types";
import styles from "./ChangesTab.module.css";

// ── Constants ─────────────────────────────────────────────────────

const MAX_VISIBLE_LINES = 150;
const IDLE_POLL_MS = 2000;

// ── Diff parser types ─────────────────────────────────────────────

interface DiffLine {
  type: "added" | "removed" | "context" | "hunk-header";
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

// ── Diff parser ───────────────────────────────────────────────────

function parseDiff(raw: string): DiffLine[] {
  const lines: DiffLine[] = [];
  const rawLines = raw.split("\n");
  let oldLine = 0;
  let newLine = 0;
  let inHeader = true;

  for (const line of rawLines) {
    // Skip diff header lines (diff --git, index, ---, +++)
    if (inHeader) {
      if (
        line.startsWith("diff --git") ||
        line.startsWith("index ") ||
        line.startsWith("---") ||
        line.startsWith("+++") ||
        line.startsWith("old mode") ||
        line.startsWith("new mode") ||
        line.startsWith("new file mode") ||
        line.startsWith("deleted file mode") ||
        line.startsWith("similarity index") ||
        line.startsWith("rename from") ||
        line.startsWith("rename to") ||
        line.startsWith("Binary files")
      ) {
        continue;
      }
      inHeader = false;
    }

    if (line.startsWith("@@")) {
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      lines.push({
        type: "hunk-header",
        content: line,
        oldLineNo: null,
        newLineNo: null,
      });
      // Reset header tracking — after a hunk, a new diff header may appear
      // if there were multiple files (shouldn't happen in fileDiff, but be safe)
    } else if (line.startsWith("+")) {
      lines.push({
        type: "added",
        content: line.slice(1),
        oldLineNo: null,
        newLineNo: newLine,
      });
      newLine++;
    } else if (line.startsWith("-")) {
      lines.push({
        type: "removed",
        content: line.slice(1),
        oldLineNo: oldLine,
        newLineNo: null,
      });
      oldLine++;
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" — skip
      continue;
    } else {
      // Context line (starts with space or is empty)
      lines.push({
        type: "context",
        content: line.startsWith(" ") ? line.slice(1) : line,
        oldLineNo: oldLine,
        newLineNo: newLine,
      });
      oldLine++;
      newLine++;
    }
  }

  return lines;
}

// ── File path helpers ─────────────────────────────────────────────

function splitPath(filePath: string): { dir: string; name: string } {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) return { dir: "", name: filePath };
  return {
    dir: filePath.slice(0, lastSlash + 1),
    name: filePath.slice(lastSlash + 1),
  };
}

function statusPillClass(status: string): string {
  switch (status) {
    case "M":
      return styles.statusM;
    case "A":
      return styles.statusA;
    case "D":
      return styles.statusD;
    case "R":
      return styles.statusR;
    default:
      return styles.statusM;
  }
}

// ── InlineDiff sub-component ──────────────────────────────────────

function InlineDiff({
  worktreePath,
  filePath,
}: {
  worktreePath: string;
  filePath: string;
}): React.JSX.Element {
  const [diffLines, setDiffLines] = useState<DiffLine[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setShowAll(false);

    window.api.git
      .fileDiff(worktreePath, filePath)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setDiffLines(parseDiff(result.data));
        } else {
          setError(result.error);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [worktreePath, filePath]);

  if (loading) {
    return <div className={styles.diffLoading}>Loading diff...</div>;
  }

  if (error) {
    return <div className={styles.diffError}>Error: {error}</div>;
  }

  if (!diffLines || diffLines.length === 0) {
    return <div className={styles.diffLoading}>No changes</div>;
  }

  const visibleLines = showAll
    ? diffLines
    : diffLines.slice(0, MAX_VISIBLE_LINES);
  const hiddenCount = diffLines.length - MAX_VISIBLE_LINES;

  return (
    <div className={styles.diffContainer}>
      {visibleLines.map((line, i) => {
        if (line.type === "hunk-header") {
          return (
            <div key={i} className={styles.hunkHeader}>
              {line.content}
            </div>
          );
        }

        const lineClass =
          line.type === "added"
            ? styles.diffLineAdded
            : line.type === "removed"
              ? styles.diffLineRemoved
              : styles.diffLineContext;

        const gutterClass =
          line.type === "added"
            ? `${styles.lineGutter} ${styles.lineGutterAdded}`
            : line.type === "removed"
              ? `${styles.lineGutter} ${styles.lineGutterRemoved}`
              : styles.lineGutter;

        const glyphClass =
          line.type === "added"
            ? `${styles.lineGlyph} ${styles.lineGlyphAdded}`
            : line.type === "removed"
              ? `${styles.lineGlyph} ${styles.lineGlyphRemoved}`
              : styles.lineGlyph;

        const glyph =
          line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";

        const lineNo =
          line.type === "removed" ? line.oldLineNo : line.newLineNo;

        return (
          <div key={i} className={`${styles.diffLine} ${lineClass}`}>
            <span className={gutterClass}>{lineNo !== null ? lineNo : ""}</span>
            <span className={glyphClass}>{glyph}</span>
            <span className={styles.lineContent}>{line.content}</span>
          </div>
        );
      })}
      {!showAll && hiddenCount > 0 && (
        <button className={styles.showMoreBtn} onClick={() => setShowAll(true)}>
          Show {hiddenCount} more lines
        </button>
      )}
    </div>
  );
}

// ── ChangesTab component ──────────────────────────────────────────

interface ChangesTabProps {
  task: TaskInfo;
}

export function ChangesTab({ task }: ChangesTabProps): React.JSX.Element {
  const workspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const idleMap = useTerminalStore((s) => s.idleMap);

  const [diffSummary, setDiffSummary] = useState<DiffSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const lastFetchRef = useRef(0);

  // Resolve absolute worktree path, falling back to workspace root
  const worktreePath =
    task.worktree && workspacePath
      ? task.worktree.startsWith("/")
        ? task.worktree
        : `${workspacePath}/${task.worktree}`
      : null;

  const effectivePath = worktreePath ?? workspacePath;

  // ── Fetch diff ────────────────────────────────────────────────

  const fetchDiff = useCallback(async () => {
    if (!effectivePath) return;

    setLoading(true);
    setError(null);

    try {
      const result = await window.api.git.diff(effectivePath);
      if (result.ok) {
        setDiffSummary(result.data);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      lastFetchRef.current = Date.now();
    }
  }, [effectivePath]);

  // Initial fetch
  useEffect(() => {
    fetchDiff();
  }, [fetchDiff]);

  // ── Auto-refresh on terminal idle ─────────────────────────────

  useEffect(() => {
    if (!task.id) return;

    const terminalId = `wt-${task.id}`;

    const interval = setInterval(() => {
      const isIdle = idleMap[terminalId];
      if (isIdle && Date.now() - lastFetchRef.current > 3000) {
        fetchDiff();
      }
    }, IDLE_POLL_MS);

    return () => clearInterval(interval);
  }, [task.id, idleMap, fetchDiff]);

  // ── Keyboard navigation ───────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!diffSummary || diffSummary.files.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          Math.min(prev + 1, diffSummary.files.length - 1),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const file = diffSummary.files[selectedIndex];
        if (file) {
          setExpandedFile((prev) => (prev === file.path ? null : file.path));
        }
      }
    },
    [diffSummary, selectedIndex],
  );

  // ── View file handler ─────────────────────────────────────────

  const handleViewFile = useCallback(
    (filePath: string, e: React.MouseEvent) => {
      e.stopPropagation();
      // Set the file tree root to the worktree so the viewer shows the correct version
      if (worktreePath) {
        const branchLabel = task.branch || "worktree";
        useFileStore.getState().setSelectedRoot({
          label: branchLabel,
          path: worktreePath,
        });
      } else {
        // No worktree — reset to repo root
        useFileStore.getState().setSelectedRoot(null);
      }
      useNavStore.getState().setActiveView("files");
      useFileStore.getState().openFile(filePath);
    },
    [worktreePath, task.branch],
  );

  // ── Render ────────────────────────────────────────────────────

  if (!effectivePath) {
    return <div className={styles.emptyState}>No workspace selected</div>;
  }

  if (loading && !diffSummary) {
    return <div className={styles.loadingState}>Loading changes...</div>;
  }

  if (error && !diffSummary) {
    return <div className={styles.errorState}>Error: {error}</div>;
  }

  if (!diffSummary || diffSummary.files.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.summaryHeader}>
          <span className={styles.summaryText}>No changes yet</span>
          <button
            className={styles.refreshBtn}
            onClick={fetchDiff}
            disabled={loading}
          >
            {loading ? "..." : "Refresh"}
          </button>
        </div>
        <div className={styles.emptyState}>
          No files changed in this branch yet.
        </div>
      </div>
    );
  }

  const fileCount = diffSummary.files.length;
  const totalAdd = diffSummary.totalAdditions;
  const totalDel = diffSummary.totalDeletions;

  return (
    <div className={styles.container} tabIndex={0} onKeyDown={handleKeyDown}>
      {/* Summary header */}
      <div className={styles.summaryHeader}>
        <span className={styles.summaryText}>
          {fileCount} file{fileCount !== 1 ? "s" : ""} changed{" "}
          <span className={styles.additions}>+{totalAdd}</span>{" "}
          <span className={styles.deletions}>&minus;{totalDel}</span>
        </span>
        <button
          className={styles.refreshBtn}
          onClick={fetchDiff}
          disabled={loading}
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {/* Info banner */}
      <div className={styles.infoBanner}>
        {worktreePath
          ? "Diff shows changes since branch diverged from base"
          : "Diff shows uncommitted working tree changes"}
      </div>

      {/* File list */}
      <div className={styles.fileList}>
        {diffSummary.files.map((file, index) => {
          const { dir, name } = splitPath(file.path);
          const isExpanded = expandedFile === file.path;

          return (
            <div key={file.path}>
              <div
                className={`${styles.fileRow} ${isExpanded ? styles.fileRowExpanded : ""}`}
                onClick={() => setExpandedFile(isExpanded ? null : file.path)}
                role="button"
                tabIndex={-1}
                data-selected={index === selectedIndex}
              >
                {/* Status pill */}
                <span
                  className={`${styles.statusPill} ${statusPillClass(file.status)}`}
                >
                  {file.status}
                </span>

                {/* File path */}
                <span className={styles.filePath}>
                  {dir && <span className={styles.fileDir}>{dir}</span>}
                  <span className={styles.fileName}>{name}</span>
                </span>

                {/* Line delta */}
                <span className={styles.lineDelta}>
                  {file.additions > 0 && (
                    <span className={styles.additions}>+{file.additions}</span>
                  )}
                  {file.deletions > 0 && (
                    <span className={styles.deletions}>
                      &minus;{file.deletions}
                    </span>
                  )}
                </span>

                {/* View file button */}
                <button
                  className={styles.viewFileBtn}
                  onClick={(e) => handleViewFile(file.path, e)}
                  title="View file"
                >
                  &rarr; View
                </button>
              </div>

              {/* Inline diff (accordion) */}
              {isExpanded && effectivePath && (
                <InlineDiff worktreePath={effectivePath} filePath={file.path} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
