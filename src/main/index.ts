import { app, BrowserWindow, shell } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { ConfigManager } from "./config";
import { createWindowStateKeeper } from "./window-state";
import { registerIpcHandlers, killAllPtys, cancelAllPlans } from "./ipc/index";
import { stopBranchWatcher } from "./ipc/workspace";
import { stopWatchers } from "./watchers";
import { closeAllWorktreeTaskWatchers } from "./ipc/git";

let mainWindow: BrowserWindow | null = null;
let configManager: ConfigManager | null = null;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  function createWindow(): void {
    configManager = new ConfigManager();
    const windowStateKeeper = createWindowStateKeeper();

    mainWindow = new BrowserWindow({
      x: windowStateKeeper.state.x,
      y: windowStateKeeper.state.y,
      width: windowStateKeeper.state.width,
      height: windowStateKeeper.state.height,
      minWidth: 900,
      minHeight: 600,
      show: false,
      titleBarStyle: "hidden",
      ...(process.platform === "darwin"
        ? { trafficLightPosition: { x: 12, y: 12 } }
        : {
            titleBarOverlay: {
              color: "#0b0b0d",
              symbolColor: "#8b8b96",
              height: 40,
            },
          }),
      backgroundColor: "#0b0b0d",
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        // sandbox defaults to true — all Node.js work runs in main process
      },
    });

    windowStateKeeper.manage(mainWindow);

    if (windowStateKeeper.state.isMaximized) {
      mainWindow.maximize();
    }

    mainWindow.on("ready-to-show", () => {
      mainWindow!.show();
    });

    mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: "deny" };
    });

    // Register IPC handlers
    registerIpcHandlers(configManager!, mainWindow);

    // Load the app
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    } else {
      mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
    }

    mainWindow.on("closed", () => {
      windowStateKeeper.unmanage();
      mainWindow = null;
    });
  }

  app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("before-quit", () => {
    stopBranchWatcher();
    stopWatchers();
    closeAllWorktreeTaskWatchers();
    killAllPtys();
    cancelAllPlans();
    if (configManager) {
      configManager.flushSync();
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
