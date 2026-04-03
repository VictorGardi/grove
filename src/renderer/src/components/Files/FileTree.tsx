import React, { useCallback, useRef, useMemo } from "react";
import type { FileTreeNode } from "@shared/types";
import { useFileStore } from "../../stores/useFileStore";
import { getFileIcon } from "./fileIcons";
import styles from "./FileTree.module.css";

// ── Chevron SVG ────────────────────────────────────────────────

function ChevronIcon({ expanded }: { expanded: boolean }): React.JSX.Element {
  return (
    <span
      className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path
          d="M3.5 2L7 5L3.5 8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

// ── Tree Row (memoized) ────────────────────────────────────────

interface TreeRowProps {
  node: FileTreeNode;
  depth: number;
  expandedSet: Set<string>;
  selectedPath: string | null;
  focusedIndex: number;
  rowIndex: number;
  onClickDir: (path: string) => void;
  onClickFile: (path: string) => void;
}

const TreeRow = React.memo(function TreeRow({
  node,
  depth,
  expandedSet,
  selectedPath,
  focusedIndex,
  rowIndex,
  onClickDir,
  onClickFile,
}: TreeRowProps): React.JSX.Element {
  const isDir = node.type === "directory";
  const isExpanded = isDir && expandedSet.has(node.path);
  const isSelected = !isDir && node.path === selectedPath;
  const isFocused = rowIndex === focusedIndex;

  const indentGuides: React.JSX.Element[] = [];
  for (let i = 0; i < depth; i++) {
    indentGuides.push(<span key={i} className={styles.indentGuide} />);
  }

  const rowClasses = [
    styles.row,
    isDir ? styles.dirRow : "",
    isSelected ? styles.rowSelected : "",
    isFocused ? styles.rowFocused : "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleClick = useCallback((): void => {
    if (isDir) {
      onClickDir(node.path);
    } else {
      onClickFile(node.path);
    }
  }, [isDir, node.path, onClickDir, onClickFile]);

  return (
    <div className={rowClasses} onClick={handleClick} data-row-index={rowIndex}>
      <span className={styles.indent}>{indentGuides}</span>
      {isDir ? (
        <ChevronIcon expanded={isExpanded} />
      ) : (
        <span className={styles.fileIconBadge}>{getFileIcon(node.name)}</span>
      )}
      <span className={styles.fileName}>{node.name}</span>
    </div>
  );
});

// ── Flatten visible tree into ordered rows ─────────────────────

interface FlatRow {
  node: FileTreeNode;
  depth: number;
}

function flattenTree(
  nodes: FileTreeNode[],
  expandedSet: Set<string>,
  depth: number,
): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (
      node.type === "directory" &&
      expandedSet.has(node.path) &&
      node.children
    ) {
      rows.push(...flattenTree(node.children, expandedSet, depth + 1));
    }
  }
  return rows;
}

// ── FileTree Component ─────────────────────────────────────────

export function FileTree(): React.JSX.Element {
  const tree = useFileStore((s) => s.tree);
  const treeLoading = useFileStore((s) => s.treeLoading);
  const expandedDirs = useFileStore((s) => s.expandedDirs);
  const openFilePath = useFileStore((s) => s.openFilePath);
  const toggleDir = useFileStore((s) => s.toggleDir);
  const expandDir = useFileStore((s) => s.expandDir);
  const collapseDir = useFileStore((s) => s.collapseDir);
  const openFile = useFileStore((s) => s.openFile);

  const scrollRef = useRef<HTMLDivElement>(null);
  const focusedIndexRef = useRef(-1);
  const [focusedIndex, setFocusedIndex] = React.useState(-1);

  const expandedSet = useMemo(() => new Set(expandedDirs), [expandedDirs]);

  const flatRows = useMemo(
    () => flattenTree(tree, expandedSet, 0),
    [tree, expandedSet],
  );

  const handleClickDir = useCallback(
    (path: string) => {
      toggleDir(path);
    },
    [toggleDir],
  );

  const handleClickFile = useCallback(
    (path: string) => {
      openFile(path);
    },
    [openFile],
  );

  // Keep ref in sync for keyboard handler
  focusedIndexRef.current = focusedIndex;

  const scrollToIndex = useCallback((index: number) => {
    const container = scrollRef.current;
    if (!container) return;
    const row = container.querySelector(
      `[data-row-index="${index}"]`,
    ) as HTMLElement | null;
    if (row) {
      row.scrollIntoView({ block: "nearest" });
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const idx = focusedIndexRef.current;
      const rowCount = flatRows.length;
      if (rowCount === 0) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = idx < rowCount - 1 ? idx + 1 : idx;
          setFocusedIndex(next);
          scrollToIndex(next);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = idx > 0 ? idx - 1 : 0;
          setFocusedIndex(prev);
          scrollToIndex(prev);
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          if (idx >= 0 && idx < rowCount) {
            const row = flatRows[idx];
            if (row.node.type === "directory") {
              if (!expandedSet.has(row.node.path)) {
                expandDir(row.node.path);
              } else {
                // Move to first child
                const next = idx + 1;
                if (next < rowCount) {
                  setFocusedIndex(next);
                  scrollToIndex(next);
                }
              }
            }
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (idx >= 0 && idx < rowCount) {
            const row = flatRows[idx];
            if (
              row.node.type === "directory" &&
              expandedSet.has(row.node.path)
            ) {
              collapseDir(row.node.path);
            } else {
              // Move to parent — find nearest directory at lower depth
              const currentDepth = row.depth;
              for (let i = idx - 1; i >= 0; i--) {
                if (
                  flatRows[i].depth < currentDepth &&
                  flatRows[i].node.type === "directory"
                ) {
                  setFocusedIndex(i);
                  scrollToIndex(i);
                  break;
                }
              }
            }
          }
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (idx >= 0 && idx < rowCount) {
            const row = flatRows[idx];
            if (row.node.type === "directory") {
              toggleDir(row.node.path);
            } else {
              openFile(row.node.path);
            }
          }
          break;
        }
      }
    },
    [
      flatRows,
      expandedSet,
      expandDir,
      collapseDir,
      toggleDir,
      openFile,
      scrollToIndex,
    ],
  );

  if (treeLoading && tree.length === 0) {
    return (
      <div className={styles.treeContainer}>
        <div className={styles.emptyState}>Loading...</div>
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className={styles.treeContainer}>
        <div className={styles.emptyState}>No files</div>
      </div>
    );
  }

  return (
    <div className={styles.treeContainer}>
      <div
        ref={scrollRef}
        className={styles.treeScroll}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {flatRows.map((row, index) => (
          <TreeRow
            key={row.node.path}
            node={row.node}
            depth={row.depth}
            expandedSet={expandedSet}
            selectedPath={openFilePath}
            focusedIndex={focusedIndex}
            rowIndex={index}
            onClickDir={handleClickDir}
            onClickFile={handleClickFile}
          />
        ))}
      </div>
    </div>
  );
}
