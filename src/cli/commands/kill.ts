import { execSync } from "child_process";
import * as os from "os";
import * as crypto from "crypto";
import { resolveWorkspace } from "../workspace.js";

interface KillOptions {
  workspace?: string;
  all?: boolean;
}

function buildContainerName(taskId: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(os.homedir())
    .digest("hex")
    .slice(0, 8);
  return `grove-task-${taskId}-${hash}`;
}

async function killCommand(
  taskId: string | null,
  options: KillOptions,
): Promise<void> {
  const wsResult = resolveWorkspace(options.workspace || null);
  if (!wsResult.ok) {
    console.error(`[Error] ${wsResult.error}`);
    process.exit(wsResult.code);
  }

  if (options.all) {
    console.log(`[grove] Stopping all containers and sessions...`);
    try {
      const containers = execSync(`docker ps -aq --filter "name=grove-task-"`, {
        encoding: "utf-8",
      }).trim();
      if (containers) {
        for (const containerId of containers.split("\n")) {
          if (containerId) {
            console.log(`[grove] Stopping container: ${containerId}`);
            execSync(`docker stop ${containerId}`, { stdio: "inherit" });
            execSync(`docker rm ${containerId}`, { stdio: "inherit" });
          }
        }
      }
    } catch (err) {
      console.log(`[grove] No containers to stop`);
    }

    // Kill all tmux sessions with grove- prefix
    try {
      const sessions = execSync(
        `tmux ls -F '#{session_name}' 2>/dev/null | grep '^grove-'`,
        {
          encoding: "utf-8",
        },
      ).trim();
      if (sessions) {
        for (const sessionName of sessions.split("\n")) {
          if (sessionName) {
            console.log(`[grove] Killing tmux session: ${sessionName}`);
            execSync(`tmux kill-session -t ${sessionName}`, {
              stdio: "ignore",
            });
          }
        }
      }
    } catch {}

    console.log(`[grove] All sessions stopped.`);
    return;
  }

  if (!taskId) {
    console.error(`[Error] Task ID required. Usage: grove kill <task-id>`);
    process.exit(1);
  }

  const containerName = buildContainerName(taskId);
  const tmuxSessionName = `grove-${taskId}`;

  console.log(`[grove] Killing session for ${taskId}...`);

  // Kill tmux session
  let killedTmux = false;
  try {
    execSync(`tmux kill-session -t ${tmuxSessionName}`, { stdio: "ignore" });
    killedTmux = true;
  } catch {}

  // Also try with hash suffix
  try {
    execSync(`tmux kill-session -t grove-${taskId.slice(2)}*`, {
      stdio: "ignore",
    });
  } catch {}

  if (killedTmux) {
    console.log(`[grove] Killed tmux session`);
  }

  // Stop and remove container
  let killedContainer = false;
  try {
    execSync(`docker inspect ${containerName}`, { stdio: "pipe" });
    console.log(`[grove] Stopping container...`);
    execSync(`docker stop ${containerName}`, { stdio: "inherit" });
    execSync(`docker rm ${containerName}`, { stdio: "inherit" });
    killedContainer = true;
  } catch {}

  if (killedContainer) {
    console.log(`[grove] Stopped container`);
  }

  if (!killedTmux && !killedContainer) {
    console.log(`[grove] No active session found for ${taskId}`);
  } else {
    console.log(`[grove] Killed ${taskId}`);
  }
}

export { killCommand };
