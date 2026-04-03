import { useEffect } from "react";
import { useFileStore } from "../../stores/useFileStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { FileTree } from "./FileTree";
import { FileSearch } from "./FileSearch";
import { FileViewer } from "./FileViewer";

/**
 * FilesView — container composing file search, tree, and viewer side by side.
 *
 * Layout:
 *   +-------------------------------+
 *   | [Search]   |  FileViewer      |
 *   | ---------- |                  |
 *   | FileTree   |                  |
 *   |            |                  |
 *   +-------------------------------+
 */
export function FilesView(): React.JSX.Element {
  const fetchTree = useFileStore((s) => s.fetchTree);
  const searchActive = useFileStore((s) => s.searchActive);
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);

  // Fetch tree on mount and whenever the active workspace changes.
  // fetchTree() is debounced and reads the workspace path internally,
  // but we need activeWorkspacePath as a dependency so this effect
  // re-runs if the workspace switches while Files view is open,
  // or if the workspace loads after this component mounts.
  useEffect(() => {
    if (activeWorkspacePath) {
      fetchTree();
    }
  }, [fetchTree, activeWorkspacePath]);

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Left panel: search + tree */}
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
        <FileSearch />
        {!searchActive && <FileTree />}
      </div>
      {/* Right panel: viewer */}
      <FileViewer />
    </div>
  );
}
