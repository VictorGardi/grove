import { ipcMain, BrowserWindow } from "electron";
import type { ConfigManager } from "../config";
import { isValidTheme } from "../config";
import { PtyManager } from "../pty";
import { AgentRunner } from "../agentRunner";
import { registerWorkspaceHandlers } from "./workspace";
import { registerTaskHandlers } from "./tasks";
import { registerFilesystemHandlers } from "./filesystem";
import { registerGitHandlers } from "./git";
import { registerPtyHandlers } from "./pty";
import { registerPlanHandlers } from "./plan";
import { registerTaskTerminalHandlers } from "./taskTerminal";
import { registerTmuxMonitorHandlers } from "./tmuxMonitor";

let ptyManager: PtyManager | null = null;
let planManager: AgentRunner | null = null;

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
  planManager = new AgentRunner();
  planManager.init(); // Clean up orphaned FIFOs on startup
  registerPlanHandlers(planManager, mainWindow);

  // Task terminal manager — interactive agent TUI sessions bound to tasks
  registerTaskTerminalHandlers(ptyManager, mainWindow);

  // tmux monitor — lists all Grove tmux sessions across workspaces
  registerTmuxMonitorHandlers(configManager);

  // app:getPlatform
  ipcMain.handle("app:getPlatform", () => process.platform);

  // app:getTheme
  ipcMain.handle("app:getTheme", () => {
    const theme = configManager.get().theme;
    return { ok: true, data: theme };
  });

  // app:setTheme
  ipcMain.handle("app:setTheme", (_event, theme: string) => {
    if (!isValidTheme(theme)) {
      return {
        ok: false,
        error: `Invalid theme: ${theme}. Valid themes are: catppuccin-mocha, catppuccin-latte, tokyo-night, evergreen`,
      };
    }
    configManager.update((cfg) => {
      cfg.theme = theme;
    });
    return { ok: true, data: theme };
  });

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

  // app:getWindowOpacity
  ipcMain.handle("app:getWindowOpacity", () => {
    const opacity = configManager.get().windowOpacity;
    return { ok: true, data: opacity };
  });

  // app:setWindowOpacity
  ipcMain.handle("app:setWindowOpacity", (_event, opacity: number) => {
    const clampedOpacity = Math.max(0.1, Math.min(1.0, opacity));
    configManager.update((cfg) => {
      cfg.windowOpacity = clampedOpacity;
    });
    if (mainWindow) {
      mainWindow.setOpacity(clampedOpacity);
    }
    return { ok: true, data: clampedOpacity };
  });
}

/**
 * Kill all PTYs. Called on app quit.
 */
export function killAllPtys(): void {
  ptyManager?.killAll();
}

/**
 * Cancel all plan agent runs. Called when explicitly cancelling (e.g., "New session").
 */
export function cancelAllPlans(): void {
  planManager?.cancelAll();
}

/**
 * Detach all plan agent runs. Called on app quit — releases resources
 * without killing the underlying tmux sessions.
 */
export function detachAllPlans(): void {
  planManager?.detachAll();
}
