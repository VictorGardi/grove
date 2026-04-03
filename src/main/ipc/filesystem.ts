import { ipcMain, BrowserWindow } from "electron";
import * as path from "path";
import type { ConfigManager } from "../config";
import type { IpcResult, FileTreeNode, FileReadResult } from "@shared/types";
import { buildFileTree, readFileContent } from "../filesystem";
import { watchOpenFile } from "../watchers";

export function registerFilesystemHandlers(
  configManager: ConfigManager,
  mainWindow: BrowserWindow,
): void {
  // fs:tree — returns recursive directory tree for a workspace
  ipcMain.handle(
    "fs:tree",
    async (
      _event,
      workspacePath: string,
    ): Promise<IpcResult<FileTreeNode[]>> => {
      try {
        // Validate workspacePath is a registered workspace
        const config = configManager.get();
        const isRegistered = config.workspaces.some(
          (w) => w.path === workspacePath,
        );
        if (!isRegistered) {
          return { ok: false, error: "Not a registered workspace" };
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
        // Validate workspacePath is a registered workspace
        const config = configManager.get();
        const isRegistered = config.workspaces.some(
          (w) => w.path === workspacePath,
        );
        if (!isRegistered) {
          return { ok: false, error: "Not a registered workspace" };
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
