import { spawn, spawnSync, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import {
  resolveWorkspace,
  detectContainerRuntime,
  findTaskInWorkspaces,
  getWorkspaces,
} from "../workspace.js";
import {
  setActiveSessionRuntime,
  clearActiveSessionRuntime,
  getActiveSessionRuntime,
} from "../../runtime/sessionService.js";
import * as taskService from "../../runtime/taskService.js";
import {
  getContainerService,
  DevcontainerManager,
} from "../../runtime/containerService.js";
import * as state from "../../runtime/state.js";

interface RunOptions {
  branch?: string;
  task?: string;
  model?: string;
  workspace?: string;
}

async function loadTaskExecutionMode(
  workspacePath: string,
  taskId: string,
): Promise<"container" | "host"> {
  const workspaces = getWorkspaces();
  const wsPath = path.resolve(workspacePath);
  const defaultToContainer = workspaces.find(
    (w) => path.resolve(w.path) === wsPath,
  )?.containerEnabled;

  const result = findTaskInWorkspaces(taskId, workspacePath);
  if (!result.ok) {
    return defaultToContainer ? "container" : "host";
  }

  try {
    const content = await fs.promises.readFile(result.taskPath, "utf-8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fmContent = fmMatch[1];
      const modeMatch = fmContent.match(/executionMode:\s*(\S+)/);
      if (modeMatch) {
        const mode = modeMatch[1].trim();
        if (mode === "container" || mode === "host") {
          return mode;
        }
      }
    }
  } catch {
    return defaultToContainer ? "container" : "host";
  }

  return defaultToContainer ? "container" : "host";
}

async function startContainerWithTmux(
  taskId: string,
  workingDirectory: string,
  tmuxSessionName: string,
  agentCommand: string,
): Promise<
  | { ok: true; containerId: string; containerName: string }
  | { ok: false; error: string }
> {
  const service = getContainerService({ enabled: true, runtime: "docker" });
  const ok = await service.initialize();
  if (!ok) {
    return { ok: false, error: "Container runtime not available" };
  }

  const devcontainerManager = new DevcontainerManager();

  const devcontainer =
    await devcontainerManager.parseDevcontainer(workingDirectory);
  if (!devcontainer) {
    return {
      ok: false,
      error: `.devcontainer/devcontainer.json not found in ${workingDirectory}. Container mode requires a devcontainer configuration.`,
    };
  }

  const imageHash =
    await devcontainerManager.computeImageHash(workingDirectory);
  const imageName = `grove-dev:${imageHash}`;

  const imageResult = await service.ensureImage(
    workingDirectory,
    imageName,
    devcontainer,
  );
  if (!imageResult.ok) {
    return { ok: false, error: imageResult.error };
  }

  const result = await service.getOrStartContainer(taskId, workingDirectory, {
    image: imageName,
    devcontainerConfig: devcontainer,
    additionalMounts: [`${os.homedir()}/.config:/home/dev/.config:ro`],
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 30;
  const tmuxResult = await service.runTmuxCommand(
    result.containerId,
    tmuxSessionName,
    agentCommand,
    "/workspace",
    cols,
    rows,
  );

  if (tmuxResult.exitCode !== 0) {
    return { ok: false, error: `tmux failed: ${tmuxResult.stderr}` };
  }

  state.saveContainerSession({
    taskId,
    containerId: result.containerId,
    containerName: result.containerName,
    workspacePath: workingDirectory,
    mode: "ephemeral",
    startedAt: Date.now(),
    image: imageName,
  });

  return {
    ok: true,
    containerId: result.containerId,
    containerName: result.containerName,
  };
}

async function createWorktree(
  workspacePath: string,
  branchName: string,
): Promise<string> {
  const { execSync } = await import("child_process");
  const worktreePath = path.join(
    path.dirname(workspacePath),
    `.worktrees/${branchName}`,
  );

  if (!fs.existsSync(worktreePath)) {
    execSync(`git worktree add "${worktreePath}" -b ${branchName}`, {
      cwd: workspacePath,
      stdio: "inherit",
    });
  }
  return worktreePath;
}

export async function runCommand(
  agent: string,
  message: string | undefined,
  options: RunOptions,
): Promise<void> {
  const wsResult = await resolveWorkspace(options.workspace ?? process.cwd());
  if (!wsResult.ok) {
    console.error(`[Error] ${wsResult.error}`);
    process.exit(wsResult.code);
  }
  const workspace = wsResult.workspace;

  console.log(`[grove] Workspace: ${workspace.path}`);

  const sessionId = Date.now()
    .toString(36)
    .replace(/[^a-z0-9]/g, "");

  let execPath = workspace.path;
  let taskId: string;

  if (options.branch) {
    console.log(`[grove] Creating worktree: ${options.branch}`);
    try {
      execPath = await createWorktree(workspace.path, options.branch);
      taskId = options.branch;
    } catch (err) {
      console.error(`[Error] Worktree: ${err}`);
      process.exit(1);
    }
  } else if (options.task) {
    taskId = options.task;
  } else {
    // Ephemeral session - NOT bound to any task
    // Use timestamp-based ID for container/tmux naming
    const timestamp = Date.now().toString(36);
    taskId = `ephemeral-${timestamp}`;
    console.log(`[grove] Starting ephemeral session: ${taskId}`);
  }

  const executionMode = await loadTaskExecutionMode(workspace.path, taskId);
  console.log(`[grove] Execution mode: ${executionMode}`);

  let containerName: string | null = null;
  let containerId: string | null = null;
  let tmuxSessionName: string | null = null;

  if (executionMode === "container") {
    tmuxSessionName = `grove-${sessionId}`;

    const { spawnSync: spawnSyncCmd } = await import("child_process");
    const getAgentPath = (name: string): string => {
      try {
        const r = spawnSyncCmd("which", [name], { encoding: "utf-8" });
        return r.status === 0 ? r.stdout.trim() : "";
      } catch {
        return "";
      }
    };

    const binPath = getAgentPath(agent);
    const useHostPath = !!binPath;

    // For container mode, always use the container-installed agent
    // The workspace default model or CLI --model takes precedence
    const modelArg = options.model ? `--model ${options.model}` : "";

    // Always open TUI. If message provided, send it after TUI loads
    // This opens the interactive TUI
    const agentCommand = agent;
    const runMessage = message ? message.trim() : null;

    console.log(`[grove] Agent: ${agent} (container-installed)`);
    if (runMessage) {
      console.log(`[grove] Message will be sent to TUI: "${runMessage}"`);
    }

    const containerResult = await startContainerWithTmux(
      taskId,
      execPath,
      tmuxSessionName,
      agentCommand,
    );

    if (!containerResult.ok) {
      console.error(
        `[grove] Failed to start container: ${containerResult.error}`,
      );
      process.exit(1);
    }

    containerName = containerResult.containerName;
    containerId = containerResult.containerId;
    console.log(`[grove] Container started: ${containerId}`);

    // If message was provided, send it after TUI loads
    if (runMessage) {
      console.log(`[grove] Sending message to TUI...`);
      try {
        execSync(
          `docker exec ${containerName} bash -c 'sleep 2 && tmux send-keys -t ${tmuxSessionName} "${runMessage.replace(/"/g, '\\"')}" C-m'`,
          {
            stdio: "inherit",
          },
        );
      } catch (err) {
        console.error(`[grove] Failed to send message: ${err}`);
      }
    }

    // Check if we have a TTY
    if (process.stdin.isTTY) {
      console.log(`[grove] Attaching to tmux session...`);
      const attachProc = spawn(
        "docker",
        ["exec", "-it", containerName, "tmux", "attach", "-t", tmuxSessionName],
        {
          stdio: "inherit",
          cwd: execPath,
          env: process.env,
        },
      );

      // Don't auto-kill on close - session detaches and keeps running
      attachProc.on("close", async (code) => {
        console.log(
          `[grove] Detached from session. Container and tmux session are still running.`,
        );
        console.log(
          `[grove] Run 'grove kill ${taskId}' to stop, or 'grove attach ${taskId}' to reconnect.`,
        );
        process.exit(0);
      });
    } else {
      console.log(
        `[grove] Session started. Run 'grove attach ${taskId}' to connect.`,
      );

      // Keep process alive but don't block
      // The container and tmux session are running in the background
      process.exit(0);
    }
  } else {
    const { spawn: spawnCmd } = await import("child_process");

    const { spawnSync: spawnSyncCmd } = await import("child_process");
    const getAgentPath = (name: string): string => {
      try {
        const r = spawnSyncCmd("which", [name], { encoding: "utf-8" });
        return r.status === 0 ? r.stdout.trim() : "";
      } catch {
        return "";
      }
    };

    const binPath = getAgentPath(agent);
    if (!binPath) {
      console.error(`[Error] ${agent} not found`);
      process.exit(1);
    }

    const proc = spawnCmd(
      binPath,
      ["run", "--agent", "build", "--", message || "hello"],
      {
        stdio: "inherit",
        cwd: execPath,
        env: process.env,
      },
    );

    proc.on("close", (code) => {
      process.exit(code ?? 0);
    });
  }
}
