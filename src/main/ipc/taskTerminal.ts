/**
 * IPC handlers for task-bound interactive terminal sessions.
 *
 * Each task can have one interactive terminal session (a tmux session running
 * the chosen agent TUI: `opencode` or `copilot`). The session survives app
 * restarts because it lives in tmux. Grove attaches to it via a node-pty
 * running `tmux attach-session`, which is piped to xterm.js in the renderer.
 *
 * Session naming: grove-term-<workspaceHash6>-<taskId>
 * Tmux session name stored in task frontmatter as `terminalSession`.
 *
 * IPC channels:
 *   taskterm:create    — create tmux session + attach PTY (new session)
 *   taskterm:reconnect — attach PTY to existing tmux session (reconnect)
 *   taskterm:capture   — capture pane content with ANSI codes (for history replay)
 *   taskterm:isalive   — check if a tmux session is alive
 *   taskterm:kill      — kill tmux session + detach PTY
 *   taskterm:write     — write data to PTY (thin wrapper, rendered also uses pty:write)
 *   taskterm:resize    — resize PTY (thin wrapper, renderer also uses pty:resize)
 *
 * Data/exit events reuse the existing pty:data and pty:exit channels.
 * The PTY id for task terminals is `taskterm-${taskId}`.
 */

import { ipcMain, BrowserWindow } from "electron";
import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { PtyManager } from "../pty";
import { buildEnvPath } from "../env";
import { updateTask } from "../tasks";
import { writeOpencodeConfig, cleanupGroveConfig } from "../opencodeConfig";

const GROVE_DIR = path.join(os.homedir(), ".grove");
const wroteConfigFiles = new Map<string, string>();

async function ensureGroveDir(): Promise<boolean> {
  try {
    await fs.promises.mkdir(GROVE_DIR, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

// ── Session name helpers ──────────────────────────────────────────

export function buildTerminalSessionName(
  workspacePath: string,
  taskId: string,
  mode: "plan" | "exec",
): string {
  const hash = crypto
    .createHash("sha256")
    .update(workspacePath)
    .digest("hex")
    .slice(0, 6);
  return `grove-term-${hash}-${taskId}-${mode}`;
}

// ── Tmux helpers ─────────────────────────────────────────────────

function tmuxSessionExists(sessionName: string): boolean {
  const result = spawnSync("tmux", ["has-session", "-t", sessionName], {
    encoding: "utf-8",
  });
  return result.status === 0;
}

function tmuxKillSession(sessionName: string): void {
  spawnSync("tmux", ["kill-session", "-t", sessionName]);
}

function tmuxCreateSession(
  sessionName: string,
  agent: string,
  cwd: string,
  model: string | null,
  cols: number,
  rows: number,
): boolean {
  const envPath = buildEnvPath();

  // Build the agent command
  let agentCmd: string;
  if (agent === "opencode") {
    // opencode <projectPath> starts TUI in that directory
    const parts = ["opencode", JSON.stringify(cwd)];
    if (model) {
      // OpenCode expects provider-qualified model IDs (e.g. "github-copilot/claude-sonnet-4.6").
      // Grove stores short IDs like "claude-sonnet-4.6" — add the provider prefix if absent.
      const qualifiedModel = model.includes("/")
        ? model
        : `github-copilot/${model}`;
      parts.push("--model", JSON.stringify(qualifiedModel));
    }
    agentCmd = parts.join(" ");
  } else {
    // copilot interactive REPL; runs from cwd via tmux -c
    const parts = ["copilot"];
    if (model) parts.push(`--model=${model}`);
    agentCmd = parts.join(" ");
  }

  const result = spawnSync(
    "tmux",
    [
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-x",
      String(cols),
      "-y",
      String(rows),
      "-c",
      cwd,
      "env",
      `TERM=xterm-256color`,
      `PATH=${envPath}`,
      "bash",
      "-c",
      agentCmd,
    ],
    { encoding: "utf-8" },
  );

  if (result.status !== 0) return false;

  // Hide the tmux status bar — it's visible when attaching via xterm.js and adds noise.
  spawnSync("tmux", ["set-option", "-t", sessionName, "status", "off"]);

  return true;
}

function tmuxCapturePane(sessionName: string): string {
  // -e includes ANSI escape codes; -S - starts from beginning of scrollback
  const result = spawnSync(
    "tmux",
    ["capture-pane", "-pt", sessionName, "-S", "-", "-e"],
    { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 },
  );
  return result.status === 0 ? (result.stdout ?? "") : "";
}

function tmuxPaneCommand(sessionName: string): string {
  const result = spawnSync(
    "tmux",
    ["display-message", "-pt", sessionName, "#{pane_current_command}"],
    { encoding: "utf-8" },
  );
  return result.status === 0 ? (result.stdout?.trim() ?? "") : "";
}

type AgentState = "active" | "interrupted" | "waiting" | "idle";

function tmuxParseAgentState(sessionName: string, agent: string): AgentState {
  const capture = tmuxCapturePane(sessionName);

  if (!capture) return "idle";

  if (agent === "copilot") {
    if (capture.includes("Esc") && capture.includes("cancel")) {
      return "active";
    }
  } else {
    if (capture.includes("esc") && capture.includes("interrupt")) {
      return "active";
    }
  }

  return "waiting";
}

// ── IPC registration ─────────────────────────────────────────────

export function registerTaskTerminalHandlers(
  ptyManager: PtyManager,
  mainWindow: BrowserWindow,
): void {
  /**
   * Create a new interactive terminal session for a task.
   * Kills any existing tmux session with the same name, creates a fresh one,
   * then attaches via node-pty.
   */
  ipcMain.handle(
    "taskterm:create",
    async (
      _event,
      params: {
        ptyId: string;
        taskId: string;
        taskFilePath: string;
        workspacePath: string;
        agent: string;
        model: string | null;
        cwd: string;
        sessionMode: "plan" | "exec";
        cols?: number;
        rows?: number;
      },
    ) => {
      const {
        ptyId,
        taskId,
        taskFilePath,
        workspacePath,
        agent,
        model,
        cwd,
        sessionMode,
      } = params;
      const sessionName = buildTerminalSessionName(
        workspacePath,
        taskId,
        sessionMode,
      );

      // Kill any stale session
      if (tmuxSessionExists(sessionName)) {
        tmuxKillSession(sessionName);
      }

      // Write opencode.json to suppress permission prompts (opencode only)
      if (agent === "opencode") {
        writeOpencodeConfig(cwd, wroteConfigFiles, sessionName);
      }

      // Create fresh tmux session with agent TUI at the actual terminal dimensions
      const cols = params.cols ?? 220;
      const rows = params.rows ?? 50;
      const ok = tmuxCreateSession(sessionName, agent, cwd, model, cols, rows);
      if (!ok) {
        return { ok: false, error: "Failed to create tmux session" };
      }

      // Persist session name to task frontmatter (correct field based on mode)
      try {
        const frontmatterUpdate =
          sessionMode === "plan"
            ? { terminalPlanSession: sessionName }
            : { terminalExecSession: sessionName };
        await updateTask(workspacePath, taskFilePath, frontmatterUpdate);
      } catch (err) {
        console.warn("[taskterm:create] Failed to persist session name:", err);
      }

      // Attach via node-pty (tmux attach-session)
      const envPath = buildEnvPath();
      ptyManager.createWithCommand(
        ptyId,
        "tmux",
        ["attach-session", "-t", sessionName],
        cwd,
        {
          cols,
          rows,
          env: { PATH: envPath, TERM: "xterm-256color" },
        },
      );

      return { ok: true, sessionName };
    },
  );

  /**
   * Reconnect to an existing tmux session for a task.
   * Always kills any existing PTY and spawns a fresh `tmux attach-session` —
   * this causes tmux to send the full current screen to the new client,
   * which is the most reliable way to get the UI to render correctly.
   * The per-entry tracking in PtyManager ensures the old PTY's async onExit
   * cannot fire a false "Session ended" event for the new PTY.
   */
  ipcMain.handle(
    "taskterm:reconnect",
    (
      _event,
      params: {
        ptyId: string;
        sessionName: string;
        cwd: string;
        cols?: number;
        rows?: number;
      },
    ) => {
      const { ptyId, sessionName, cwd } = params;

      if (!tmuxSessionExists(sessionName)) {
        return { ok: false, error: "Session no longer running" };
      }

      const envPath = buildEnvPath();
      // createWithCommand kills any existing PTY with this id before spawning.
      // PtyManager's per-entry tracking prevents the old exit from affecting the new PTY.
      ptyManager.createWithCommand(
        ptyId,
        "tmux",
        ["attach-session", "-t", sessionName],
        cwd,
        {
          cols: params.cols ?? 220,
          rows: params.rows ?? 50,
          env: { PATH: envPath, TERM: "xterm-256color" },
        },
      );

      return { ok: true };
    },
  );

  /**
   * Capture the current pane content (with ANSI codes) for history replay.
   */
  ipcMain.handle("taskterm:capture", (_event, sessionName: string) => {
    if (!tmuxSessionExists(sessionName)) {
      return { ok: false, content: "" };
    }
    const content = tmuxCapturePane(sessionName);
    return { ok: true, content };
  });

  /**
   * Check if a tmux session is still alive.
   */
  ipcMain.handle("taskterm:isalive", (_event, sessionName: string) => {
    return tmuxSessionExists(sessionName);
  });

  /**
   * Kill a task terminal session (tmux session + PTY).
   */
  ipcMain.handle(
    "taskterm:kill",
    (_event, params: { ptyId: string; sessionName: string }) => {
      ptyManager.kill(params.ptyId);
      tmuxKillSession(params.sessionName);
      cleanupGroveConfig(wroteConfigFiles, params.sessionName);
      const filePath = path.join(GROVE_DIR, `context-${params.sessionName}.md`);
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // Best-effort cleanup
      }
      return { ok: true };
    },
  );

  /**
   * Get the current command running in the tmux pane (for agent state detection).
   * Returns the process name (e.g. "opencode", "copilot", "bash").
   */
  ipcMain.handle("taskterm:panecommand", (_event, sessionName: string) => {
    return tmuxPaneCommand(sessionName);
  });

  /**
   * Get the agent state (active/interrupted/waiting/idle) by parsing the terminal output.
   * Returns one of:
   *   - "active": agent is thinking/working (shows elapsed time in status bar)
   *   - "interrupted": agent is paused (shows "interrupted" in status bar)
   *   - "waiting": agent is waiting for user input (status bar shows just name)
   *   - "idle": no active session
   */
  ipcMain.handle(
    "taskterm:state",
    (_event, sessionName: string, agent: string) => {
      if (!tmuxSessionExists(sessionName)) return "idle";
      return tmuxParseAgentState(sessionName, agent);
    },
  );

  /**
   * Write the initial context/instructions for a session to a temp file.
   * Returns the absolute path so the renderer can inject a "read this file"
   * instruction into the agent's input.
   */
  ipcMain.handle(
    "taskterm:writecontext",
    async (_event, params: { sessionName: string; content: string }) => {
      try {
        if (!(await ensureGroveDir())) {
          return { ok: false, error: "Failed to create grove directory" };
        }
        const filePath = path.join(
          GROVE_DIR,
          `context-${params.sessionName}.md`,
        );
        fs.writeFileSync(filePath, params.content, "utf-8");
        return { ok: true, filePath };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Keep renderer side-effect free: forward pty:data for taskterm PTY IDs too.
  // This is already handled by the existing PtyManager + registerPtyHandlers,
  // which emit pty:data for ALL PTY IDs including taskterm-* ones.
  // No extra wiring needed.
  void mainWindow; // suppress unused warning
}
