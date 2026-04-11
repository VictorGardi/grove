import { ipcMain } from "electron";
import { spawnSync } from "child_process";
import * as crypto from "crypto";
import type { TmuxSessionInfo, TaskStatus } from "@shared/types";
import { scanTasks } from "../tasks";
import type { ConfigManager } from "../config";

function isTmuxAvailable(): boolean {
  const result = spawnSync("tmux", ["-V"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0;
}

function hashWorkspace(workspacePath: string): string {
  return crypto
    .createHash("sha256")
    .update(workspacePath)
    .digest("hex")
    .slice(0, 6);
}

interface ParsedSessionName {
  mode: "plan" | "exec";
  hash: string;
  taskId: string;
}

function parseAgentSessionName(name: string): ParsedSessionName | null {
  const match = name.match(/^grove-(plan|exec)-([a-f0-9]{6})-(.+)$/);
  if (!match) return null;
  return {
    mode: match[1] as "plan" | "exec",
    hash: match[2],
    taskId: match[3],
  };
}

function parseTermSessionName(name: string): ParsedSessionName | null {
  const match = name.match(/^grove-term-([a-f0-9]{6})-(.+)-(plan|exec)$/);
  if (!match) return null;
  return {
    mode: match[3] as "plan" | "exec",
    hash: match[1],
    taskId: match[2],
  };
}

export function registerTmuxMonitorHandlers(
  configManager: ConfigManager,
): void {
  ipcMain.handle(
    "tmux:listGroveSessions",
    async (): Promise<TmuxSessionInfo[]> => {
      if (!isTmuxAvailable()) {
        return [];
      }

      const result = spawnSync(
        "tmux",
        [
          "list-panes",
          "-a",
          "-F",
          "#{session_name}|#{pane_current_command}|#{pane_pid}|#{pane_dead}|#{session_created}|#{pane_activity}",
        ],
        { encoding: "utf-8" },
      );

      if (result.status !== 0) {
        return [];
      }

      const output = result.stdout ?? "";
      const lines = output.trim().split("\n").filter(Boolean);
      const rowsBySession = new Map<string, string>();
      for (const line of lines) {
        const parts = line.split("|");
        if (parts.length >= 6) {
          const sessionName = parts[0];
          if (!rowsBySession.has(sessionName)) {
            rowsBySession.set(sessionName, line);
          }
        }
      }

      const workspaces = configManager.get().workspaces;
      const hashToWorkspace = new Map<
        string,
        { workspacePath: string; workspaceName: string }
      >();
      for (const ws of workspaces) {
        const hash = hashWorkspace(ws.path);
        hashToWorkspace.set(hash, {
          workspacePath: ws.path,
          workspaceName: ws.name,
        });
      }

      const sessions: TmuxSessionInfo[] = [];
      const now = Math.floor(Date.now() / 1000);

      for (const [sessionName, row] of rowsBySession) {
        if (!sessionName.startsWith("grove-")) continue;

        const parts = row.split("|");
        if (parts.length < 6) continue;

        const paneCommand = parts[1];
        const panePid = parseInt(parts[2], 10);
        const paneDead = parts[3] === "1";
        const sessionCreatedTs = parseInt(parts[4], 10);
        const paneActivityTs = parseInt(parts[5], 10);

        let parsed: ParsedSessionName | null = null;
        let sessionType: TmuxSessionInfo["sessionType"] = "exec";

        if (sessionName.startsWith("grove-term-")) {
          parsed = parseTermSessionName(sessionName);
          if (parsed) {
            sessionType = parsed.mode === "plan" ? "term-plan" : "term-exec";
          }
        } else {
          parsed = parseAgentSessionName(sessionName);
          if (parsed) {
            sessionType = parsed.mode === "plan" ? "plan" : "exec";
          }
        }

        if (!parsed) continue;

        let taskStatus: TaskStatus | null = null;
        let agent: string | null = null;
        let model: string | null = null;
        let workspacePath: string | null = null;
        let workspaceName: string | null = null;

        const wsInfo = hashToWorkspace.get(parsed.hash);
        if (wsInfo) {
          workspacePath = wsInfo.workspacePath;
          workspaceName = wsInfo.workspaceName;

          try {
            const tasks = await scanTasks(workspacePath);
            const task = tasks.find((t) => t.id === parsed!.taskId);
            if (task) {
              taskStatus = task.status;
              agent = task.execSessionAgent || task.planSessionAgent || null;
              model = task.execModel || task.planModel || null;
            }
          } catch {
            // Workspace may not be accessible
          }
        }

        const idleSeconds =
          paneActivityTs > 0 ? Math.max(0, now - paneActivityTs) : 0;
        const durationSeconds =
          sessionCreatedTs > 0 ? Math.max(0, now - sessionCreatedTs) : 0;

        sessions.push({
          sessionName,
          sessionType,
          workspaceHash: parsed.hash,
          workspacePath,
          workspaceName,
          taskId: parsed.taskId,
          taskStatus,
          agent,
          model,
          paneCommand,
          panePid: isNaN(panePid) ? 0 : panePid,
          paneDead,
          sessionCreatedTs: isNaN(sessionCreatedTs) ? 0 : sessionCreatedTs,
          paneActivityTs: isNaN(paneActivityTs) ? 0 : paneActivityTs,
          idleSeconds,
          durationSeconds,
        });
      }

      return sessions;
    },
  );

  ipcMain.handle(
    "tmux:killSession",
    (
      _event,
      params: { sessionName: string },
    ): { ok: boolean; error?: string } => {
      if (!isTmuxAvailable()) {
        return { ok: false, error: "tmux is not available" };
      }

      const result = spawnSync(
        "tmux",
        ["kill-session", "-t", params.sessionName],
        {
          encoding: "utf-8",
        },
      );

      if (result.status === 0) {
        return { ok: true };
      }
      return {
        ok: false,
        error: result.stderr
          ? result.stderr.toString()
          : "Failed to kill session",
      };
    },
  );
}
