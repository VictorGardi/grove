import { ipcMain, BrowserWindow } from "electron";
import type { ConfigManager } from "../config";
import { PtyManager } from "../pty";
import { registerWorkspaceHandlers } from "./workspace";
import { registerTaskHandlers } from "./tasks";
import { registerFilesystemHandlers } from "./filesystem";
import { registerGitHandlers } from "./git";
import { registerPtyHandlers } from "./pty";

let ptyManager: PtyManager | null = null;

export function registerIpcHandlers(
  configManager: ConfigManager,
  mainWindow: BrowserWindow,
): void {
  registerWorkspaceHandlers(configManager, mainWindow);
  registerTaskHandlers();
  registerFilesystemHandlers(configManager, mainWindow);
  registerGitHandlers();

  // PTY manager — lifecycle managed here
  ptyManager = new PtyManager();
  registerPtyHandlers(ptyManager, mainWindow);

  // app:getPlatform
  ipcMain.handle("app:getPlatform", () => process.platform);
}

/**
 * Kill all PTYs. Called on app quit.
 */
export function killAllPtys(): void {
  ptyManager?.killAll();
}
