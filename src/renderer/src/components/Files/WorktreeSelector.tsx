import { useState, useEffect, useCallback } from "react";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useFileStore } from "../../stores/useFileStore";
import type { BranchInfo } from "@shared/types";
import styles from "./WorktreeSelector.module.css";

/**
 * WorktreeSelector — dropdown at the top of the Files view left panel.
 * Shows ALL local branches. Branches with worktrees show the worktree
 * filesystem path; branches without worktrees read committed state via git show.
 */
export function WorktreeSelector(): React.JSX.Element | null {
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const activeWorkspaceName = useWorkspaceStore((s) => {
    const ws = s.workspaces.find((w) => w.path === s.activeWorkspacePath);
    return ws?.name ?? "repo";
  });
  const selectedRoot = useFileStore((s) => s.selectedRoot);
  const setSelectedRoot = useFileStore((s) => s.setSelectedRoot);
  const fetchTree = useFileStore((s) => s.fetchTree);

  const [branches, setBranches] = useState<BranchInfo[]>([]);

  const loadBranches = useCallback(async () => {
    if (!activeWorkspacePath) {
      setBranches([]);
      return;
    }
    try {
      const result = await window.api.git.listBranches(activeWorkspacePath);
      if (result.ok) {
        setBranches(result.data);
      }
    } catch {
      setBranches([]);
    }
  }, [activeWorkspacePath]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  // Refresh branch list when data changes (task moved to doing/done → new worktree)
  useEffect(() => {
    const unsub = window.api.data.onChanged(() => {
      loadBranches();
    });
    return unsub;
  }, [loadBranches]);

  // Don't show if no workspace
  if (!activeWorkspacePath) return null;

  // Derive current select value
  // Encoding: "" = workspace root, "wt:<path>" = worktree, "br:<name>" = git branch only
  let currentValue = "";
  if (selectedRoot) {
    if (selectedRoot.gitBranch) {
      currentValue = `br:${selectedRoot.gitBranch}`;
    } else {
      currentValue = `wt:${selectedRoot.path}`;
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const value = e.target.value;

    if (value === "") {
      setSelectedRoot(null);
    } else if (value.startsWith("wt:")) {
      const wtPath = value.slice(3);
      const branch = branches.find((b) => b.worktreePath === wtPath);
      setSelectedRoot({
        label: branch?.name ?? wtPath,
        path: wtPath,
      });
    } else if (value.startsWith("br:")) {
      const branchName = value.slice(3);
      setSelectedRoot({
        label: branchName,
        path: activeWorkspacePath!,
        gitBranch: branchName,
      });
    }

    // Re-fetch tree after state update
    setTimeout(() => fetchTree(), 0);
  }

  return (
    <div className={styles.container}>
      <label className={styles.label}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          className={styles.branchIcon}
        >
          <path
            d="M5 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5 11a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM11 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M5 7v4M11 7v1.5c0 1.5-1 2.5-3 2.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        Root
      </label>
      <select
        className={styles.select}
        value={currentValue}
        onChange={handleChange}
      >
        <option value="">{activeWorkspaceName} (repo root)</option>
        {branches.map((b) => {
          if (b.worktreePath) {
            // Has worktree — show filesystem path
            return (
              <option
                key={`wt:${b.worktreePath}`}
                value={`wt:${b.worktreePath}`}
              >
                {b.name} (worktree)
              </option>
            );
          } else {
            // Branch only — show committed state
            return (
              <option key={`br:${b.name}`} value={`br:${b.name}`}>
                {b.name}
                {b.isCurrent ? " (current)" : ""}
              </option>
            );
          }
        })}
      </select>
    </div>
  );
}
