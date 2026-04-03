import { ipcMain, BrowserWindow } from "electron";
import * as path from "path";
import type { ConfigManager } from "../config";
import type {
  IpcResult,
  FileTreeNode,
  FileReadResult,
  AppConfig,
} from "@shared/types";
import { buildFileTree, readFileContent } from "../filesystem";
import { watchOpenFile } from "../watchers";

/**
 * Check if a path is allowed for filesystem operations.
 * Allows:
 *   1. Direct registered workspace paths
 *   2. Worktree paths that are children of a registered workspace's .worktrees/ directory
 */
function isAllowedPath(targetPath: string, config: AppConfig): boolean {
  const resolved = path.resolve(targetPath);

  // Direct registered workspace
  if (config.workspaces.some((w) => path.resolve(w.path) === resolved)) {
    return true;
  }

  // Worktree of a registered workspace: <registered>/.worktrees/<id>
  return config.workspaces.some((w) => {
    const worktreesDir =
      path.join(path.resolve(w.path), ".worktrees") + path.sep;
    return resolved.startsWith(worktreesDir);
  });
}

export function registerFilesystemHandlers(
  configManager: ConfigManager,
  mainWindow: BrowserWindow,
): void {
  // fs:tree — returns recursive directory tree for a workspace or worktree
  ipcMain.handle(
    "fs:tree",
    async (
      _event,
      workspacePath: string,
    ): Promise<IpcResult<FileTreeNode[]>> => {
      try {
        const config = configManager.get();
        if (!isAllowedPath(workspacePath, config)) {
          return { ok: false, error: "Not a registered workspace or worktree" };
        }

        const tree = await buildFileTree(workspacePath);
        return { ok: true, data: tree };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );

  // fs:readFile — reads file content with security validation
  ipcMain.handle(
    "fs:readFile",
    async (
      _event,
      workspacePath: string,
      relativePath: string,
    ): Promise<IpcResult<FileReadResult>> => {
      try {
        const config = configManager.get();
        if (!isAllowedPath(workspacePath, config)) {
          return { ok: false, error: "Not a registered workspace or worktree" };
        }

        const result = await readFileContent(workspacePath, relativePath);

        // Auto-start watching the file for content changes
        // (only for successfully read files, not binary/tooLarge)
        if ("content" in result) {
          const absolutePath = path.resolve(workspacePath, relativePath);
          watchOpenFile(absolutePath, mainWindow);
        }

        return { ok: true, data: result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );
}
