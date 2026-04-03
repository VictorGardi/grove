import React, {
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useState,
} from "react";
import Fuse from "fuse.js";
import type { FileTreeNode } from "@shared/types";
import { useFileStore } from "../../stores/useFileStore";
import styles from "./FileSearch.module.css";

// ── Flatten tree to searchable items ───────────────────────────

interface SearchableFile {
  name: string;
  path: string;
}

function flattenFiles(nodes: FileTreeNode[]): SearchableFile[] {
  const result: SearchableFile[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      result.push({ name: node.name, path: node.path });
    }
    if (node.type === "directory" && node.children) {
      result.push(...flattenFiles(node.children));
    }
  }
  return result;
}

// ── Highlight matched characters ───────────────────────────────

function highlightMatch(
  text: string,
  indices: readonly [number, number][] | undefined,
): React.ReactNode {
  if (!indices || indices.length === 0) return text;

  const chars = text.split("");
  const highlighted = new Set<number>();
  for (const [start, end] of indices) {
    for (let i = start; i <= end; i++) {
      highlighted.add(i);
    }
  }

  const parts: React.ReactNode[] = [];
  let current = "";
  let inHighlight = false;

  for (let i = 0; i < chars.length; i++) {
    const isH = highlighted.has(i);
    if (isH !== inHighlight) {
      if (current) {
        parts.push(
          inHighlight ? (
            <span key={`h${i}`} className={styles.matchHighlight}>
              {current}
            </span>
          ) : (
            <span key={`n${i}`}>{current}</span>
          ),
        );
      }
      current = "";
      inHighlight = isH;
    }
    current += chars[i];
  }

  if (current) {
    parts.push(
      inHighlight ? (
        <span key="last-h" className={styles.matchHighlight}>
          {current}
        </span>
      ) : (
        <span key="last-n">{current}</span>
      ),
    );
  }

  return <>{parts}</>;
}

// ── Get the directory portion of a path ────────────────────────

function getDirPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash <= 0) return "";
  return filePath.slice(0, lastSlash);
}

// ── FileSearch Component ───────────────────────────────────────

export function FileSearch(): React.JSX.Element {
  const tree = useFileStore((s) => s.tree);
  const searchQuery = useFileStore((s) => s.searchQuery);
  const setSearchQuery = useFileStore((s) => s.setSearchQuery);
  const setSearchActive = useFileStore((s) => s.setSearchActive);
  const searchFocusCounter = useFileStore((s) => s.searchFocusCounter);
  const openFile = useFileStore((s) => s.openFile);

  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Flatten tree for fuse search
  const flatFiles = useMemo(() => flattenFiles(tree), [tree]);

  // Create fuse instance
  const fuse = useMemo(
    () =>
      new Fuse(flatFiles, {
        keys: [
          { name: "name", weight: 0.7 },
          { name: "path", weight: 0.3 },
        ],
        threshold: 0.3,
        distance: 100,
        ignoreLocation: true,
        includeMatches: true,
      }),
    [flatFiles],
  );

  // Search results
  const results = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return fuse.search(searchQuery, { limit: 50 });
  }, [fuse, searchQuery]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length]);

  // Focus input when searchFocusCounter changes
  useEffect(() => {
    if (searchFocusCounter > 0 && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [searchFocusCounter]);

  // Update searchActive state
  useEffect(() => {
    setSearchActive(searchQuery.trim().length > 0);
  }, [searchQuery, setSearchActive]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    [setSearchQuery],
  );

  const handleSelectResult = useCallback(
    (path: string) => {
      openFile(path);
      setSearchQuery("");
    },
    [openFile, setSearchQuery],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (results[selectedIndex]) {
          handleSelectResult(results[selectedIndex].item.path);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSearchQuery("");
        inputRef.current?.blur();
      }
    },
    [results, selectedIndex, handleSelectResult, setSearchQuery],
  );

  const hasQuery = searchQuery.trim().length > 0;

  return (
    <>
      <div className={styles.searchContainer}>
        <input
          ref={inputRef}
          className={styles.searchInput}
          type="text"
          placeholder="Search files... (Cmd+P)"
          value={searchQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      {hasQuery && (
        <div className={styles.resultsList}>
          {results.length === 0 ? (
            <div className={styles.noResults}>No matching files</div>
          ) : (
            results.map((result, index) => {
              const nameMatch = result.matches?.find((m) => m.key === "name");
              const pathMatch = result.matches?.find((m) => m.key === "path");

              return (
                <div
                  key={result.item.path}
                  className={`${styles.resultRow} ${index === selectedIndex ? styles.resultRowSelected : ""}`}
                  onClick={() => handleSelectResult(result.item.path)}
                >
                  <span className={styles.resultName}>
                    {highlightMatch(result.item.name, nameMatch?.indices)}
                  </span>
                  <span className={styles.resultPath}>
                    {pathMatch
                      ? highlightMatch(
                          getDirPath(result.item.path),
                          pathMatch.indices,
                        )
                      : getDirPath(result.item.path)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </>
  );
}
