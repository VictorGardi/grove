import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import * as path from "path";
import type { PlanManager } from "../planManager";
import type { IpcResult, PlanAgent, PlanMode } from "@shared/types";
import { updateTask } from "../tasks";
import { buildTmuxSessionName } from "../tmuxSupervisor";

const VALID_AGENTS: PlanAgent[] = ["opencode", "copilot"];
const VALID_MODES: PlanMode[] = ["plan", "execute"];

export function registerPlanHandlers(
  planManager: PlanManager,
  mainWindow: BrowserWindow,
): void {
  // Wire chunk forwarding to renderer — now includes mode for routing.
  //
  // Chunks are micro-batched: we collect all chunks emitted within a single
  // event-loop turn and flush them as one IPC message ("plan:chunks", plural).
  // This prevents a synchronous burst of N individual send() calls during log
  // replay (which could be hundreds of lines) from overwhelming the IPC queue.
  // Live streaming is unaffected — a single chunk still appears within the same
  // event-loop tick.
  interface BatchEntry {
    taskId: string;
    mode: string;
    chunk: import("@shared/types").PlanChunk;
  }
  const pendingChunks: BatchEntry[] = [];
  let flushScheduled = false;

  const flushChunks = (): void => {
    flushScheduled = false;
    if (pendingChunks.length === 0 || mainWindow.isDestroyed()) {
      pendingChunks.length = 0;
      return;
    }
    const batch = pendingChunks.splice(0);
    mainWindow.webContents.send("plan:chunks", batch);
  };

  planManager.setOnChunk((taskId, mode, chunk) => {
    console.log(
      `[PlanIPC] queuing chunk type=${chunk.type} taskId=${taskId} mode=${mode}`,
    );
    pendingChunks.push({ taskId, mode, chunk });
    if (!flushScheduled) {
      flushScheduled = true;
      setImmediate(flushChunks);
    }
  });

  // plan:send — first message (sessionId is null) or follow-up (sessionId set)
  ipcMain.handle(
    "plan:updateExitCode",
    async (
      _event,
      input: {
        workspacePath: string;
        taskFilePath: string;
        mode: PlanMode;
        exitCode: number | null;
      },
    ): Promise<IpcResult<void>> => {
      try {
        const changes =
          input.mode === "execute"
            ? { execLastExitCode: input.exitCode }
            : { planLastExitCode: input.exitCode };
        await updateTask(input.workspacePath, input.taskFilePath, changes);
        return { ok: true, data: undefined };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    "plan:send",
    async (
      _event,
      input: {
        taskId: string;
        mode: PlanMode;
        agent: PlanAgent;
        model: string | null;
        message: string;
        /** Short user-facing text for chat history (not the full prompt) */
        displayMessage: string;
        sessionId: string | null;
        workspacePath: string;
        taskFilePath: string;
        worktreePath?: string; // required when mode === "execute"
      },
    ): Promise<IpcResult<void>> => {
      try {
        // Validate input types
        if (typeof input.taskId !== "string" || !input.taskId) {
          return { ok: false, error: "Invalid taskId" };
        }
        if (!VALID_MODES.includes(input.mode)) {
          return { ok: false, error: `Invalid mode: ${String(input.mode)}` };
        }
        if (!VALID_AGENTS.includes(input.agent)) {
          return { ok: false, error: `Invalid agent: ${String(input.agent)}` };
        }
        if (typeof input.message !== "string" || !input.message) {
          return { ok: false, error: "Invalid message" };
        }
        if (input.sessionId !== null && typeof input.sessionId !== "string") {
          return { ok: false, error: "Invalid sessionId" };
        }
        if (typeof input.workspacePath !== "string" || !input.workspacePath) {
          return { ok: false, error: "Invalid workspacePath" };
        }
        if (typeof input.taskFilePath !== "string" || !input.taskFilePath) {
          return { ok: false, error: "Invalid taskFilePath" };
        }

        let cwd: string;

        if (input.mode === "execute") {
          // Execute mode: use worktree path when provided, otherwise fall back
          // to workspace root (root-repo mode — useWorktree: false on the task).
          cwd =
            typeof input.worktreePath === "string" && input.worktreePath
              ? input.worktreePath
              : input.workspacePath;
        } else {
          // Plan mode: CWD is workspace root; taskFilePath must be inside .tasks/
          const resolvedTask = path.resolve(input.taskFilePath);
          const tasksDir = path.resolve(
            path.join(input.workspacePath, ".tasks"),
          );
          if (!resolvedTask.startsWith(tasksDir + path.sep)) {
            return {
              ok: false,
              error: "taskFilePath must be inside workspace .tasks/ directory",
            };
          }
          cwd = input.workspacePath;
        }

        planManager.run(
          input.taskId,
          input.mode,
          input.agent,
          input.model ?? null,
          input.message,
          input.displayMessage ?? "",
          input.sessionId,
          cwd,
          input.taskFilePath,
          input.workspacePath,
          // onComplete: intentionally no-op — the session name must remain in
          // frontmatter so the log can be replayed on every future app restart.
          async () => {},
        );

        const tmuxSession = buildTmuxSessionName(
          input.workspacePath,
          input.taskId,
          input.mode,
        );
        const tmuxChanges =
          input.mode === "execute"
            ? { execTmuxSession: tmuxSession }
            : { planTmuxSession: tmuxSession };
        await updateTask(input.workspacePath, input.taskFilePath, tmuxChanges);

        return { ok: true, data: undefined };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // plan:cancel — abort the current run for a task+mode
  ipcMain.handle(
    "plan:cancel",
    async (
      _event,
      input: {
        taskId: string;
        mode: PlanMode;
        workspacePath: string;
        taskFilePath: string;
      },
    ): Promise<IpcResult<void>> => {
      try {
        const runKey = `${input.mode}:${input.taskId}`;
        planManager.cancel(runKey, input.workspacePath);

        // Intentionally do NOT clear planTmuxSession / execTmuxSession from
        // frontmatter here.  The log file is preserved by kill() so it can be
        // replayed on the next app open for history.  Clearing the session name
        // would prevent that replay.  handleNewSession() in the renderer is
        // responsible for clearing it when the user explicitly starts fresh.

        return { ok: true, data: undefined };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // plan:saveSession — called by renderer after receiving session_id chunk
  // Writes mode-appropriate frontmatter fields.
  ipcMain.handle(
    "plan:saveSession",
    async (
      _event,
      input: {
        workspacePath: string;
        filePath: string;
        sessionId: string;
        agent: PlanAgent;
        model: string | null;
        mode: PlanMode;
      },
    ): Promise<IpcResult<void>> => {
      try {
        const changes =
          input.mode === "execute"
            ? {
                execSessionId: input.sessionId,
                execSessionAgent: input.agent,
                execModel: input.model ?? null,
              }
            : {
                planSessionId: input.sessionId,
                planSessionAgent: input.agent,
                planModel: input.model ?? null,
              };
        await updateTask(input.workspacePath, input.filePath, changes);
        return { ok: true, data: undefined };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // plan:listModels — return available models for the given agent
  // For opencode: runs `opencode models` and parses the output.
  // For copilot: returns a curated static list (no CLI enumeration available).
  const COPILOT_MODELS = [
    "claude-sonnet-4.6",
    "claude-sonnet-4.5",
    "claude-opus-4.6",
    "claude-opus-4.6-fast",
    "claude-haiku-4.5",
    "gpt-4o",
    "gpt-4o-mini",
    "o1",
    "o1-mini",
    "o3-mini",
    "gemini-2.0-flash",
  ];

  ipcMain.handle(
    "plan:listModels",
    async (
      _event,
      input: { agent: PlanAgent; workspacePath: string },
    ): Promise<IpcResult<string[]>> => {
      try {
        if (input.agent === "copilot") {
          return { ok: true, data: COPILOT_MODELS };
        }
        const models = await planManager.listModels(input.workspacePath);
        return { ok: true, data: models };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    "plan:is-tmux-available",
    async (): Promise<IpcResult<boolean>> => {
      try {
        const available = await planManager.isTmuxAvailable();
        return { ok: true, data: available };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    "plan:tmux-check",
    async (
      _event,
      input: { workspacePath: string; taskId: string; mode: PlanMode },
    ): Promise<IpcResult<{ alive: boolean }>> => {
      try {
        const tmuxSession = buildTmuxSessionName(
          input.workspacePath,
          input.taskId,
          input.mode,
        );
        const available = await planManager.isTmuxAvailable();
        if (!available) {
          return { ok: true, data: { alive: false } };
        }
        const alive = await planManager.checkTmuxSession(tmuxSession);
        return { ok: true, data: { alive } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    "plan:tmux-capture-pane",
    async (
      _event,
      input: { session: string },
    ): Promise<IpcResult<{ content: string }>> => {
      try {
        if (!input.session) {
          return { ok: false, error: "No session name provided" };
        }
        const content = await planManager.captureTmuxPane(input.session);
        return { ok: true, data: { content } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    "plan:reconnect",
    async (
      _event,
      input: {
        taskId: string;
        mode: PlanMode;
        agent: PlanAgent;
        workspacePath: string;
        taskFilePath: string;
      },
    ): Promise<IpcResult<{ reconnected: boolean; sessionAlive: boolean }>> => {
      try {
        const tmuxSession = buildTmuxSessionName(
          input.workspacePath,
          input.taskId,
          input.mode,
        );

        // onComplete: intentionally no-op — the session name must remain in
        // frontmatter so the log can be replayed on every future app restart.
        const onComplete = async () => {};

        const result = await planManager.reconnectTmuxSession(
          tmuxSession,
          input.taskId,
          input.mode,
          input.agent,
          onComplete,
        );
        return {
          ok: true,
          data: {
            reconnected: result.reconnected,
            sessionAlive: result.sessionAlive,
          },
        };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );
}
