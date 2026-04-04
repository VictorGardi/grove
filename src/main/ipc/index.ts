import { ipcMain, BrowserWindow } from "electron";
import type { ConfigManager } from "../config";
import { PtyManager } from "../pty";
import { PlanManager } from "../planManager";
import { registerWorkspaceHandlers } from "./workspace";
import { registerTaskHandlers } from "./tasks";
import { registerFilesystemHandlers } from "./filesystem";
import { registerGitHandlers } from "./git";
import { registerPtyHandlers } from "./pty";
import { registerPlanHandlers } from "./plan";

let ptyManager: PtyManager | null = null;
let planManager: PlanManager | null = null;

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

  // Plan manager — lifecycle managed here
  planManager = new PlanManager();
  registerPlanHandlers(planManager, mainWindow);

  // app:getPlatform
  ipcMain.handle("app:getPlatform", () => process.platform);

  // app:setTitleBarColor — Windows only, no-op on other platforms
  ipcMain.handle(
    "app:setTitleBarColor",
    (_event, opts: { color: string; symbolColor: string }) => {
      if (process.platform === "win32" && mainWindow) {
        mainWindow.setTitleBarOverlay({
          color: opts.color,
          symbolColor: opts.symbolColor,
          height: 40,
        });
      }
    },
  );
}

/**
 * Kill all PTYs. Called on app quit.
 */
export function killAllPtys(): void {
  ptyManager?.killAll();
}

/**
 * Cancel all plan agent runs. Called on app quit.
 */
export function cancelAllPlans(): void {
  planManager?.cancelAll();
}
