import chokidar from "chokidar";
import * as path from "path";
import type { BrowserWindow } from "electron";
import { TASKS_DIR } from "./paths";

let taskWatcher: chokidar.FSWatcher | null = null;
let fileTreeWatcher: chokidar.FSWatcher | null = null;
let openFileWatcher: chokidar.FSWatcher | null = null;
let treeDebounceTimer: NodeJS.Timeout | null = null;

export function startWatchers(
  workspacePath: string,
  mainWindow: BrowserWindow,
): void {
  stopWatchers();

  // Task file watcher
  taskWatcher = chokidar.watch(
    path.join(workspacePath, TASKS_DIR, "**", "*.md"),
    {
      ignoreInitial: true,
      ignored: /\.tmp$/,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    },
  );

  taskWatcher.on("all", () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("workspace:dataChanged");
    }
  });

  // File tree watcher — watches workspace root for structural changes
  fileTreeWatcher = chokidar.watch(workspacePath, {
    ignoreInitial: true,
    ignored: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.worktrees/**",
      "**/.grove/**",
    ],
    depth: 20,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  // Only fire on structural changes (add/remove), not content changes
  fileTreeWatcher.on("all", (event) => {
    if (["add", "unlink", "addDir", "unlinkDir"].includes(event)) {
      if (treeDebounceTimer) clearTimeout(treeDebounceTimer);
      treeDebounceTimer = setTimeout(() => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send("fs:treeChanged");
        }
      }, 500);
    }
  });
}

export function stopWatchers(): void {
  taskWatcher?.close();
  fileTreeWatcher?.close();
  unwatchOpenFile();
  taskWatcher = null;
  fileTreeWatcher = null;
  if (treeDebounceTimer) {
    clearTimeout(treeDebounceTimer);
    treeDebounceTimer = null;
  }
}

/**
 * Watch a single file for content changes (auto-reload in viewer).
 * Called automatically when fs:readFile succeeds.
 * Replaces any previous file watch.
 */
export function watchOpenFile(
  filePath: string,
  mainWindow: BrowserWindow,
): void {
  unwatchOpenFile();
  openFileWatcher = chokidar.watch(filePath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  openFileWatcher.on("change", () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("fs:fileChanged", filePath);
    }
  });
}

function unwatchOpenFile(): void {
  openFileWatcher?.close();
  openFileWatcher = null;
}
