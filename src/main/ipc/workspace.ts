import { ipcMain, dialog, BrowserWindow } from "electron";
import * as fs from "fs";
import * as path from "path";
import simpleGit from "simple-git";
import type { ConfigManager } from "../config";
import type {
  IpcResult,
  WorkspaceInfo,
  WorkspaceEntry,
  PlanAgent,
} from "@shared/types";
import { initTaskDirs, parseTaskFile } from "../tasks";
import { startWatchers, stopWatchers } from "../watchers";
import { startWorktreeTaskWatcher } from "./git";

// Branch watcher state
let headWatcher: fs.FSWatcher | null = null;
let watchedWorkspacePath: string | null = null;

const ALL_TASK_STATUS_DIRS = ["doing", "review", "done", "backlog", "archive"];

/**
 * After workspace activation, scan all task files for tasks that have an
 * active worktree and re-establish the worktree→root sync watcher for each.
 * This handles the case where the app was restarted while tasks were in-flight.
 */
async function reestablishWorktreeTaskWatchers(
  workspacePath: string,
): Promise<void> {
  for (const dir of ALL_TASK_STATUS_DIRS) {
    const dirPath = path.join(workspacePath, ".tasks", dir);
    let entries: string[];
    try {
      entries = await fs.promises.readdir(dirPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const filePath = path.join(dirPath, entry);
      // Use "doing" as a placeholder status — only the worktree field matters here
      const task = await parseTaskFile(filePath, "doing").catch(() => null);
      if (!task || !task.worktree || !task.id) continue;

      // The worktree copy always lives at .tasks/doing/<filename> inside the worktree
      const worktreeTaskFilePath = path.join(
        workspacePath,
        task.worktree,
        ".tasks",
        "doing",
        entry,
      );

      // Only watch if the worktree directory and the task file copy both exist
      const worktreeDirPath = path.join(workspacePath, task.worktree);
      try {
        await fs.promises.access(worktreeDirPath);
        // startWorktreeTaskWatcher is idempotent — safe to call even if already watching
        startWorktreeTaskWatcher(
          workspacePath,
          task.id,
          worktreeTaskFilePath,
          entry,
        );
      } catch {
        // Worktree directory doesn't exist — skip
      }
    }
  }
}

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

        // Re-establish worktree task file sync watchers for any in-flight tasks
        await reestablishWorktreeTaskWatchers(wPath);

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
          // Re-establish worktree task file sync watchers for any in-flight tasks
          await reestablishWorktreeTaskWatchers(activePath);
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

  // workspace:getDefaults
  ipcMain.handle(
    "workspace:getDefaults",
    async (
      _event,
      wPath: string,
    ): Promise<
      IpcResult<{
        defaultPlanningAgent?: PlanAgent;
        defaultPlanningModel?: string;
        defaultExecutionAgent?: PlanAgent;
        defaultExecutionModel?: string;
      }>
    > => {
      try {
        const config = configManager.get();
        const workspace = config.workspaces.find((w) => w.path === wPath);
        if (!workspace) {
          return { ok: false, error: "Workspace not found" };
        }
        return {
          ok: true,
          data: {
            defaultPlanningAgent: workspace.defaultPlanningAgent,
            defaultPlanningModel: workspace.defaultPlanningModel,
            defaultExecutionAgent: workspace.defaultExecutionAgent,
            defaultExecutionModel: workspace.defaultExecutionModel,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );

  // workspace:setDefaults
  ipcMain.handle(
    "workspace:setDefaults",
    async (
      _event,
      wPath: string,
      defaults: {
        defaultPlanningAgent?: PlanAgent;
        defaultPlanningModel?: string;
        defaultExecutionAgent?: PlanAgent;
        defaultExecutionModel?: string;
      },
    ): Promise<IpcResult<void>> => {
      try {
        configManager.update((c) => {
          const workspace = c.workspaces.find((w) => w.path === wPath);
          if (workspace) {
            if (defaults.defaultPlanningAgent !== undefined) {
              workspace.defaultPlanningAgent = defaults.defaultPlanningAgent;
            }
            if (defaults.defaultPlanningModel !== undefined) {
              workspace.defaultPlanningModel = defaults.defaultPlanningModel;
            }
            if (defaults.defaultExecutionAgent !== undefined) {
              workspace.defaultExecutionAgent = defaults.defaultExecutionAgent;
            }
            if (defaults.defaultExecutionModel !== undefined) {
              workspace.defaultExecutionModel = defaults.defaultExecutionModel;
            }
          }
        });
        configManager.flushSync();
        return { ok: true, data: undefined };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );
}

export { stopBranchWatcher, startBranchWatcher };
