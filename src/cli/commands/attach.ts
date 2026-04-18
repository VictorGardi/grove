import { execSync } from "child_process";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import * as pty from "node-pty";
import { resolveWorkspace } from "../workspace.js";

interface AttachOptions {
  workspace?: string;
}

function buildContainerName(taskId: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(os.homedir())
    .digest("hex")
    .slice(0, 8);
  return `grove-task-${taskId}-${hash}`;
}

async function attachCommand(
  taskId: string,
  options: AttachOptions,
): Promise<void> {
  const wsResult = resolveWorkspace(options.workspace || null);
  if (!wsResult.ok) {
    console.error(`[Error] ${wsResult.error}`);
    process.exit(wsResult.code);
  }
  const workspace = wsResult.workspace;

  console.log(`[grove] Using workspace: ${workspace.path}`);

  // Build container name
  const containerName = buildContainerName(taskId);

  // Check if container exists and is running
  try {
    execSync(`docker inspect ${containerName}`, { stdio: "pipe" });
  } catch {
    console.error(`[Error] Container not found for task ${taskId}`);
    console.log(`[Hint] Run 'grove run -t ${taskId}' to start a session`);
    process.exit(1);
  }

  // Get container status
  const statusResult = execSync(
    `docker inspect ${containerName} --format '{{.State.Status}}'`,
    { encoding: "utf-8" },
  );
  if (statusResult.trim() !== "running") {
    console.error(`[Error] Container is not running`);
    process.exit(1);
  }

  // Find tmux sessions in container
  let tmuxSessionName: string;
  try {
    const sessionsResult = execSync(
      `docker exec ${containerName} tmux list-sessions -F '#{session_name}'`,
      { encoding: "utf-8" },
    );
    const sessions = sessionsResult.trim().split("\n").filter(Boolean);

    if (sessions.length === 0) {
      console.error(`[Error] No tmux sessions found in container`);
      process.exit(1);
    }

    // Use the first session (or ask if multiple)
    tmuxSessionName = sessions[0];
    console.log(`[grove] Found tmux session: ${tmuxSessionName}`);
  } catch {
    console.error(`[Error] Failed to list tmux sessions in container`);
    process.exit(1);
  }

  console.log(`[grove] Attaching to container: ${containerName}`);

  // Use node-pty to spawn docker exec inside container
  // Using -t to allocate a pseudo-TTY (even though we don't have one, node-pty provides it)
  // Use full docker path to avoid PATH issues with node-pty
  const dockerPath = execSync("which docker", { encoding: "utf-8" }).trim();
  const ptyProcess = pty.spawn(
    dockerPath,
    [
      "exec",
      "-it",
      containerName,
      "tmux",
      "attach-session",
      "-t",
      tmuxSessionName,
    ],
    {
      name: "xterm-256color",
      cols: process.stdout.columns || 120,
      rows: process.stdout.rows || 30,
      cwd: workspace.path,
      env: {
        ...process.env,
        TERM: "xterm-256color",
      },
    },
  );

  // Forward stdin to the PTY
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on("data", (data) => {
    if (data.length === 1 && data[0] === 3) {
      ptyProcess.kill();
      process.exit(0);
    }
    ptyProcess.write(data.toString());
  });

  // Forward PTY output to stdout
  ptyProcess.onData((data: string) => {
    process.stdout.write(data);
  });

  // Handle resize
  if (process.stdout.isTTY) {
    const resizeHandler = () => {
      ptyProcess.resize(process.stdout.columns, process.stdout.rows);
    };
    process.stdout.on("resize", resizeHandler);
    ptyProcess.resize(process.stdout.columns, process.stdout.rows);
  }

  // Cleanup on exit
  ptyProcess.onExit(({ exitCode }) => {
    process.exit(exitCode);
  });

  process.on("SIGINT", () => {
    ptyProcess.kill();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    ptyProcess.kill();
    process.exit(0);
  });
}

export { attachCommand };
