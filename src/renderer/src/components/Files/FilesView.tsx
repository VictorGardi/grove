import { useEffect } from "react";
import { useFileStore } from "../../stores/useFileStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { FileTree } from "./FileTree";
import { FileSearch } from "./FileSearch";
import { FileViewer } from "./FileViewer";
import { WorktreeSelector } from "./WorktreeSelector";

/**
 * FilesView — container composing file search, tree, and viewer side by side.
 *
 * Layout:
 *   +-------------------------------+
 *   | [Worktree]  |  FileViewer     |
 *   | [Search]    |                 |
 *   | ----------  |                 |
 *   | FileTree    |                 |
 *   |             |                 |
 *   +-------------------------------+
 */
export function FilesView(): React.JSX.Element {
  const fetchTree = useFileStore((s) => s.fetchTree);
  const searchActive = useFileStore((s) => s.searchActive);
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const selectedRoot = useFileStore((s) => s.selectedRoot);

  // Fetch tree on mount and whenever the active workspace or selected root changes.
  useEffect(() => {
    if (activeWorkspacePath) {
      fetchTree();
    }
  }, [fetchTree, activeWorkspacePath, selectedRoot]);

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Left panel: worktree selector + search + tree */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 280,
          minWidth: 280,
          overflow: "hidden",
          background: "var(--bg-surface)",
          borderRight: "1px solid var(--border)",
        }}
      >
        <WorktreeSelector />
        <FileSearch />
        {!searchActive && <FileTree />}
      </div>
      {/* Right panel: viewer */}
      <FileViewer />
    </div>
  );
}
