import { ipcMain, dialog, BrowserWindow } from "electron";
import * as fs from "fs";
import * as path from "path";
import simpleGit from "simple-git";
import type { ConfigManager } from "../config";
import type { IpcResult, WorkspaceInfo, WorkspaceEntry } from "@shared/types";
import { initTaskDirs } from "../tasks";
import { startWatchers, stopWatchers } from "../watchers";

// Branch watcher state
let headWatcher: fs.FSWatcher | null = null;
let watchedWorkspacePath: string | null = null;

function stopBranchWatcher(): void {
  if (headWatcher) {
    try {
      headWatcher.close();
    } catch {
      // ignore
    }
    headWatcher = null;
  }
  watchedWorkspacePath = null;
}

function startBranchWatcher(
  workspacePath: string,
  mainWindow: BrowserWindow,
): void {
  stopBranchWatcher();

  const headPath = path.join(workspacePath, ".git", "HEAD");
  if (!fs.existsSync(headPath)) return;

  watchedWorkspacePath = workspacePath;

  try {
    headWatcher = fs.watch(headPath, async () => {
      try {
        const git = simpleGit(workspacePath);
        const raw = await git.revparse(["--abbrev-ref", "HEAD"]);
        const branch = raw.trim() === "HEAD" ? "(detached)" : raw.trim();
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send("workspace:branchChanged", {
            path: workspacePath,
            branch,
          });
        }
      } catch {
        // ignore git errors
      }
    });

    headWatcher.on("error", (err) => {
      console.warn("[BranchWatcher] Watcher error:", err);
      stopBranchWatcher();
    });
  } catch (err) {
    console.warn("[BranchWatcher] Failed to start watcher:", err);
  }
}

export function registerWorkspaceHandlers(
  configManager: ConfigManager,
  mainWindow: BrowserWindow,
): void {
  // workspace:list
  ipcMain.handle(
    "workspace:list",
    async (): Promise<IpcResult<WorkspaceInfo[]>> => {
      try {
        const config = configManager.get();
        const workspaces: WorkspaceInfo[] = [];

        for (const entry of config.workspaces) {
          const exists = fs.existsSync(entry.path);
          let branch: string | null = null;
          let isGitRepo = false;

          if (exists) {
            try {
              const git = simpleGit(entry.path);
              isGitRepo = await git.checkIsRepo();
              if (isGitRepo) {
                const raw = await git.revparse(["--abbrev-ref", "HEAD"]);
                branch = raw.trim() === "HEAD" ? "(detached)" : raw.trim();
              }
            } catch {
              // Git error — still show workspace, just without branch info
            }
          }

          workspaces.push({
            name: entry.name,
            path: entry.path,
            branch,
            isGitRepo,
            exists,
          });
        }

        return { ok: true, data: workspaces };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );

  // workspace:add
  ipcMain.handle(
    "workspace:add",
    async (): Promise<IpcResult<WorkspaceEntry | null>> => {
      try {
        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ["openDirectory"],
          title: "Select Workspace Folder",
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { ok: true, data: null };
        }

        const selectedPath = result.filePaths[0];
        const config = configManager.get();

        if (config.workspaces.some((w) => w.path === selectedPath)) {
          return { ok: false, error: "Workspace already added" };
        }

        const name = path.basename(selectedPath);
        const entry: WorkspaceEntry = { name, path: selectedPath };

        configManager.update((c) => {
          c.workspaces.push(entry);
          c.lastActiveWorkspace = selectedPath;
        });

        // Initialize directories and start watchers for the new active workspace
        await initTaskDirs(selectedPath);
        startWatchers(selectedPath, mainWindow);
        startBranchWatcher(selectedPath, mainWindow);

        return { ok: true, data: entry };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );

  // workspace:addPath (for testing/programmatic use)
  ipcMain.handle(
    "workspace:addPath",
    async (_event, wPath: string): Promise<IpcResult<WorkspaceEntry>> => {
      try {
        const config = configManager.get();

        if (config.workspaces.some((w) => w.path === wPath)) {
          return { ok: false, error: "Workspace already added" };
        }

        const name = path.basename(wPath);
        const entry: WorkspaceEntry = { name, path: wPath };

        configManager.update((c) => {
          c.workspaces.push(entry);
          c.lastActiveWorkspace = wPath;
        });

        return { ok: true, data: entry };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );

  // workspace:remove
  ipcMain.handle(
    "workspace:remove",
    async (_event, wPath: string): Promise<IpcResult<void>> => {
      try {
        configManager.update((c) => {
          c.workspaces = c.workspaces.filter((w) => w.path !== wPath);
          if (c.lastActiveWorkspace === wPath) {
            c.lastActiveWorkspace =
              c.workspaces.length > 0 ? c.workspaces[0].path : null;
          }
        });

        // Stop watchers if watching removed workspace
        if (watchedWorkspacePath === wPath) {
          stopBranchWatcher();
          stopWatchers();
        }

        return { ok: true, data: undefined };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );

  // workspace:setActive
  ipcMain.handle(
    "workspace:setActive",
    async (_event, wPath: string): Promise<IpcResult<void>> => {
      try {
        configManager.update((c) => {
          c.lastActiveWorkspace = wPath;
        });

        // Initialize task directories
        await initTaskDirs(wPath);

        // Start file watchers for the new active workspace
        startWatchers(wPath, mainWindow);
        startBranchWatcher(wPath, mainWindow);

        return { ok: true, data: undefined };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );

  // workspace:getActive
  ipcMain.handle(
    "workspace:getActive",
    async (): Promise<IpcResult<string | null>> => {
      try {
        const config = configManager.get();
        const activePath = config.lastActiveWorkspace;

        // Start watchers for the restored active workspace on app launch
        if (activePath && fs.existsSync(activePath)) {
          startWatchers(activePath, mainWindow);
          startBranchWatcher(activePath, mainWindow);
        }

        return { ok: true, data: activePath };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );

  // workspace:getBranch
  ipcMain.handle(
    "workspace:getBranch",
    async (_event, wPath: string): Promise<IpcResult<string>> => {
      try {
        const git = simpleGit(wPath);
        const raw = await git.revparse(["--abbrev-ref", "HEAD"]);
        const branch = raw.trim() === "HEAD" ? "(detached)" : raw.trim();
        return { ok: true, data: branch };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );
}

export { stopBranchWatcher, startBranchWatcher };
