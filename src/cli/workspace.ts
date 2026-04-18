import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface WorkspaceEntry {
  name: string;
  path: string;
  defaultPlanningAgent?: string;
  defaultPlanningModel?: string;
  defaultExecutionAgent?: string;
  defaultExecutionModel?: string;
  planPersona?: string;
  planReviewPersona?: string;
  executePersona?: string;
  executeReviewPersona?: string;
  executeReviewInstructions?: string;
  hidden?: boolean;
  containerEnabled?: boolean;
  containerRuntime?: "docker" | "podman";
  containerDefaultImage?: string;
}

const GROVE_CONFIG_DIR = path.join(os.homedir(), ".grove");
const GROVE_CONFIG_PATH = path.join(GROVE_CONFIG_DIR, "config.json");

export interface GroveCliConfig {
  workspaces: WorkspaceEntry[];
  lastActiveWorkspace: string | null;
}

const DEFAULT_CONFIG: GroveCliConfig = {
  workspaces: [],
  lastActiveWorkspace: null,
};

function loadConfig(): GroveCliConfig {
  try {
    if (!fs.existsSync(GROVE_CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG };
    }
    const raw = fs.readFileSync(GROVE_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.workspaces && Array.isArray(parsed.workspaces)) {
      return parsed as GroveCliConfig;
    }
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config: GroveCliConfig): void {
  try {
    fs.mkdirSync(GROVE_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      GROVE_CONFIG_PATH,
      JSON.stringify(config, null, 2),
      "utf-8",
    );
  } catch (err) {
    console.error("[Config] Failed to save config:", err);
  }
}

export function getWorkspaces(): WorkspaceEntry[] {
  return loadConfig().workspaces;
}

export function addWorkspace(workspace: WorkspaceEntry): void {
  const config = loadConfig();
  const existing = config.workspaces.findIndex(
    (w) => w.path === workspace.path,
  );
  if (existing >= 0) {
    config.workspaces[existing] = workspace;
  } else {
    config.workspaces.push(workspace);
  }
  saveConfig(config);
}

export function updateWorkspaceContainerEnabled(
  workspacePath: string,
  enabled: boolean,
): void {
  const config = loadConfig();
  const existing = config.workspaces.findIndex((w) => w.path === workspacePath);
  if (existing >= 0) {
    config.workspaces[existing].containerEnabled = enabled;
  } else {
    config.workspaces.push({
      name: path.basename(workspacePath),
      path: workspacePath,
      containerEnabled: enabled,
    });
  }
  saveConfig(config);
}

export function resolveWorkspace(
  explicitPath: string | null,
):
  | { ok: true; workspace: WorkspaceEntry }
  | { ok: false; error: string; code: number } {
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) {
      return {
        ok: false,
        error: `Workspace not found: ${explicitPath}`,
        code: 2,
      };
    }
    const tasksPath = path.join(explicitPath, ".tasks");
    if (!fs.existsSync(tasksPath)) {
      return {
        ok: false,
        error: `Not a workspace (no .tasks directory): ${explicitPath}`,
        code: 2,
      };
    }
    const entry: WorkspaceEntry = {
      name: path.basename(explicitPath),
      path: explicitPath,
    };
    return { ok: true, workspace: entry };
  }

  const config = loadConfig();
  const cwd = process.cwd();
  const cwdTasksPath = path.join(cwd, ".tasks");
  if (fs.existsSync(cwdTasksPath)) {
    const existing = config.workspaces.find((w) => w.path === cwd);
    const entry: WorkspaceEntry = {
      name: path.basename(cwd),
      path: cwd,
      containerEnabled: existing?.containerEnabled,
    };
    addWorkspace(entry);
    return { ok: true, workspace: entry };
  }

  if (config.lastActiveWorkspace && fs.existsSync(config.lastActiveWorkspace)) {
    const tasksPath = path.join(config.lastActiveWorkspace, ".tasks");
    if (fs.existsSync(tasksPath)) {
      const entry = config.workspaces.find(
        (w) => w.path === config.lastActiveWorkspace,
      );
      if (entry) {
        return { ok: true, workspace: entry };
      }
      return {
        ok: true,
        workspace: {
          name: path.basename(config.lastActiveWorkspace),
          path: config.lastActiveWorkspace,
        },
      };
    }
  }

  if (config.workspaces.length > 0) {
    for (const ws of config.workspaces) {
      if (fs.existsSync(ws.path)) {
        const tasksPath = path.join(ws.path, ".tasks");
        if (fs.existsSync(tasksPath)) {
          return { ok: true, workspace: ws };
        }
      }
    }
  }

  return {
    ok: false,
    error:
      "No workspace found. Use --workspace or run from a directory with .tasks/",
    code: 2,
  };
}

export function findTaskInWorkspaces(
  taskId: string,
  workspacePath: string | null,
):
  | { ok: true; workspacePath: string; taskPath: string }
  | { ok: false; error: string; code: number } {
  if (workspacePath) {
    const taskPath = resolveTaskPath(workspacePath, taskId);
    if (taskPath) {
      return { ok: true, workspacePath, taskPath };
    }
    return {
      ok: false,
      error: `Task ${taskId} not found in workspace`,
      code: 3,
    };
  }

  const config = loadConfig();
  const matches: string[] = [];

  for (const ws of config.workspaces) {
    if (!fs.existsSync(ws.path)) continue;
    const taskPath = resolveTaskPath(ws.path, taskId);
    if (taskPath) {
      matches.push(ws.path);
    }
  }

  if (matches.length === 0) {
    return {
      ok: false,
      error: `Task ${taskId} not found in any workspace`,
      code: 3,
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      error: `Task ${taskId} found in multiple workspaces. Use --workspace to specify: ${matches.join(", ")}`,
      code: 3,
    };
  }

  const taskPath = resolveTaskPath(matches[0], taskId)!;
  return { ok: true, workspacePath: matches[0], taskPath };
}

function resolveTaskPath(workspacePath: string, taskId: string): string | null {
  const taskBase = path.join(workspacePath, ".tasks");
  const statuses = ["backlog", "doing", "review", "done"];

  for (const status of statuses) {
    const candidate = path.join(taskBase, status, `${taskId}.md`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function isAgentAvailable(agent: string): boolean {
  try {
    const { spawnSync } = require("child_process");
    const result = spawnSync(agent, ["--version"], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

export type ContainerRuntime = "docker" | "podman";

export async function detectContainerRuntime(): Promise<ContainerRuntime | null> {
  try {
    const { spawnSync } = await import("child_process");

    const dockerResult = spawnSync("docker", ["--version"], {
      encoding: "utf-8",
    });
    if (dockerResult.status === 0) {
      return "docker";
    }

    const podmanResult = spawnSync("podman", ["--version"], {
      encoding: "utf-8",
    });
    if (podmanResult.status === 0) {
      return "podman";
    }

    return null;
  } catch {
    return null;
  }
}
