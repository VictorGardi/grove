import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { resolveWorkspace, findTaskInWorkspaces } from "../workspace.js";
import { getActiveSessionRuntime } from "../../runtime/sessionService.js";

interface ExecOptions {
  task?: string;
  workspace?: string;
  tty?: boolean;
}

interface TaskContext {
  taskId: string;
  executionMode: "container" | "host";
  workingDirectory: string;
  workspacePath: string;
}

function buildContainerName(taskId: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(os.homedir())
    .digest("hex")
    .slice(0, 8);
  return `grove-task-${taskId}-${hash}`;
}

async function loadTaskExecutionMode(
  workspacePath: string,
  taskId: string,
): Promise<"container" | "host"> {
  const result = findTaskInWorkspaces(taskId, workspacePath);
  if (!result.ok) {
    return "host";
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
    // Ignore errors, default to host
  }

  return "host";
}

async function resolveTaskFromWorktree(cwd: string): Promise<string | null> {
  const worktreesMatch = cwd.match(/\.worktrees\/(T-\d+)/);
  if (worktreesMatch) {
    return worktreesMatch[1];
  }
  return null;
}

async function resolveTaskFromMetadata(cwd: string): Promise<string | null> {
  const metadataPath = path.join(cwd, ".grove-task.json");
  try {
    const content = await fs.promises.readFile(metadataPath, "utf-8");
    const metadata = JSON.parse(content);
    return metadata.taskId || null;
  } catch {
    return null;
  }
}

async function resolveTaskContext(
  explicitTaskId: string | undefined,
  explicitWorkspace: string | undefined,
): Promise<TaskContext> {
  const wsResult = resolveWorkspace(explicitWorkspace || null);
  if (!wsResult.ok) {
    throw new Error(`Workspace not found: ${wsResult.error}`);
  }
  const workspacePath = wsResult.workspace.path;

  let taskId: string;
  if (explicitTaskId) {
    taskId = explicitTaskId;
  } else {
    const cwd = process.cwd();
    const fromWorktree = await resolveTaskFromWorktree(cwd);
    const fromMetadata = await resolveTaskFromMetadata(cwd);

    if (fromWorktree) {
      taskId = fromWorktree;
    } else if (fromMetadata) {
      taskId = fromMetadata;
    } else {
      throw new Error(
        "No task context found. Use --task or run inside a task worktree directory.",
      );
    }
  }

  const executionMode = await loadTaskExecutionMode(workspacePath, taskId);

  let workingDirectory: string;
  const worktreePath = path.join(workspacePath, ".worktrees", taskId);
  if (fs.existsSync(worktreePath)) {
    workingDirectory = worktreePath;
  } else {
    workingDirectory = workspacePath;
  }

  return { taskId, executionMode, workingDirectory, workspacePath };
}

async function ensureContainer(
  containerName: string,
  workingDirectory: string,
): Promise<boolean> {
  const { execSync } = await import("child_process");

  try {
    const inspectResult = execSync(`docker inspect ${containerName}`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
    const container = JSON.parse(inspectResult);

    if (container[0]?.State?.Running) {
      return true;
    }

    execSync(`docker start ${containerName}`, { stdio: "pipe" });
    return true;
  } catch {
    // Container doesn't exist or not running, try to create
  }

  try {
    execSync(
      `docker run -d --name ${containerName} --entrypoint sleep -w /workspace -v ${workingDirectory}:/workspace ubuntu:22.04 infinity`,
      { stdio: "pipe" },
    );
    return true;
  } catch (err) {
    console.error(`[grove exec] Failed to start container:`, err);
    return false;
  }
}

async function executeInContainer(
  containerName: string,
  cmd: string[],
  tty: boolean,
): Promise<number> {
  return new Promise((resolve) => {
    const ttyFlag = tty ? "-it" : "-i";
    const args = ["exec", ttyFlag, containerName, ...cmd];
    const proc = spawn("docker", args, {
      stdio: "inherit",
      env: process.env,
    });

    proc.on("close", (code) => resolve(code ?? 1));
  });
}

async function executeOnHost(cmd: string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(cmd[0], cmd.slice(1), {
      stdio: "inherit",
      cwd,
      env: process.env,
    });

    proc.on("close", (code) => resolve(code ?? 1));
  });
}

async function execCommand(
  cmd: string,
  args: string[],
  options: ExecOptions,
): Promise<void> {
  const cmdArgs = [cmd, ...args];

  if (cmdArgs.length === 0 || !cmd) {
    console.error("[grove exec] Error: No command provided");
    process.exit(1);
  }

  const ctx = await resolveTaskContext(options.task, options.workspace);
  const tty = options.tty ?? false;

  let exitCode: number;

  if (ctx.executionMode === "container") {
    let containerName = buildContainerName(ctx.taskId);

    const activeRuntime = getActiveSessionRuntime(
      ctx.taskId,
      ctx.workspacePath,
      "exec",
    );
    if (activeRuntime) {
      console.log(
        `[grove] task=${ctx.taskId} container=${activeRuntime.containerName} action=exec cmd="${cmdArgs.join(" ")}"`,
      );
      exitCode = await executeInContainer(
        activeRuntime.containerName,
        cmdArgs,
        tty,
      );
    } else {
      console.log(
        `[grove] task=${ctx.taskId} container=${containerName} action=exec cmd="${cmdArgs.join(" ")}"`,
      );
      const containerReady = await ensureContainer(
        containerName,
        ctx.workingDirectory,
      );

      if (!containerReady) {
        console.error(
          `[grove] Error: Container not available for task=${ctx.taskId}`,
        );
        exitCode = await executeOnHost(cmdArgs, ctx.workingDirectory);
      } else {
        exitCode = await executeInContainer(containerName, cmdArgs, tty);
      }
    }
  } else {
    console.log(
      `[grove] task=${ctx.taskId} action=exec cmd="${cmdArgs.join(" ")}"`,
    );
    exitCode = await executeOnHost(cmdArgs, ctx.workingDirectory);
  }

  process.exit(exitCode);
}

export { execCommand };
