import { ipcMain, BrowserWindow } from "electron";
import type { ConfigManager } from "../config";
import { isValidTheme } from "../config";
import { PtyManager } from "../pty";
import { registerWorkspaceHandlers } from "./workspace";
import { registerTaskHandlers } from "./tasks";
import { registerFilesystemHandlers } from "./filesystem";
import { registerGitHandlers } from "./git";
import { registerPtyHandlers } from "./pty";
import { registerPlanHandlers } from "./plan";
import { registerTaskTerminalHandlers } from "./taskTerminal";
import { registerOpencodeServerHandlers } from "./opencodeServer";

let ptyManager: PtyManager | null = null;

export function registerIpcHandlers(
  configManager: ConfigManager,
  mainWindow: BrowserWindow,
): void {
  registerWorkspaceHandlers(configManager, mainWindow);
  registerTaskHandlers();
  registerFilesystemHandlers(configManager, mainWindow);
  registerGitHandlers();

  ptyManager = new PtyManager();
  registerPtyHandlers(ptyManager, mainWindow);

  registerPlanHandlers();

  registerTaskTerminalHandlers(ptyManager, mainWindow, configManager);

  registerOpencodeServerHandlers();

  ipcMain.handle("app:getPlatform", () => process.platform);

  ipcMain.handle("app:getTheme", () => {
    const theme = configManager.get().theme;
    return { ok: true, data: theme };
  });

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

  ipcMain.handle("app:getWindowOpacity", () => {
    const opacity = configManager.get().windowOpacity;
    return { ok: true, data: opacity };
  });

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

export function killAllPtys(): void {
  ptyManager?.killAll();
}
