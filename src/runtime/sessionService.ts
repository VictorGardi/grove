import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { PlanAgent, PlanMode } from "@shared/types";
import {
  saveContainerSession,
  removeContainerSession,
  getContainerSession,
} from "./state.js";

export interface SessionInfo {
  sessionId: string;
  agent: PlanAgent;
  model: string | null;
  containerName?: string;
  containerId?: string;
  startedAt?: number;
}

const activeSessionRuntime = new Map<
  string,
  {
    sessionId: string;
    containerName: string;
    containerId: string;
    workspacePath: string;
    taskId: string;
    mode: PlanMode;
    startedAt: number;
  }
>();

export function setActiveSessionRuntime(
  taskId: string,
  workspacePath: string,
  mode: PlanMode,
  sessionId: string,
  containerName: string,
  containerId: string,
): void {
  const key = `${workspacePath}:${taskId}:${mode}`;
  activeSessionRuntime.set(key, {
    sessionId,
    containerName,
    containerId,
    workspacePath,
    taskId,
    mode,
    startedAt: Date.now(),
  });

  saveContainerSession({
    containerId,
    containerName,
    taskId,
    workspacePath,
    mode: "task-bound",
    startedAt: Date.now(),
    image: "",
    sessionId,
  });
}

export function getActiveSessionRuntime(
  taskId: string,
  workspacePath: string,
  mode: PlanMode,
): { sessionId: string; containerName: string; containerId: string } | null {
  const key = `${workspacePath}:${taskId}:${mode}`;
  const runtime = activeSessionRuntime.get(key);
  if (runtime) {
    return {
      sessionId: runtime.sessionId,
      containerName: runtime.containerName,
      containerId: runtime.containerId,
    };
  }

  const persisted = getContainerSession(taskId);
  if (persisted) {
    return {
      sessionId: persisted.sessionId || "",
      containerName: persisted.containerName,
      containerId: persisted.containerId,
    };
  }

  return null;
}

export function hasActiveSessionRuntime(
  taskId: string,
  workspacePath: string,
  mode: PlanMode,
): boolean {
  const key = `${workspacePath}:${taskId}:${mode}`;
  return activeSessionRuntime.has(key);
}

export function clearActiveSessionRuntime(
  taskId: string,
  workspacePath: string,
  mode: PlanMode,
): void {
  const key = `${workspacePath}:${taskId}:${mode}`;
  activeSessionRuntime.delete(key);
  removeContainerSession(taskId);
}

const sessionsDir = path.join(process.env.HOME ?? "", ".grove", "sessions");

async function ensureSessionsDir(): Promise<void> {
  await fs.promises.mkdir(sessionsDir, { recursive: true });
}

function sessionFilePath(
  workspacePath: string,
  taskId: string,
  mode: PlanMode,
): string {
  const hash = crypto
    .createHash("sha256")
    .update(workspacePath)
    .digest("hex")
    .slice(0, 8);
  return path.join(sessionsDir, `${mode}-${taskId}-${hash}.json`);
}

export async function getTaskSession(
  workspacePath: string,
  taskId: string,
  mode: PlanMode,
): Promise<SessionInfo | null> {
  const filePath = sessionFilePath(workspacePath, taskId, mode);
  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(content) as SessionInfo;
  } catch {
    return null;
  }
}

export async function saveTaskSession(
  workspacePath: string,
  taskId: string,
  mode: PlanMode,
  sessionId: string,
  agent: PlanAgent,
  model: string | null,
): Promise<void> {
  await ensureSessionsDir();
  const filePath = sessionFilePath(workspacePath, taskId, mode);
  const content = JSON.stringify({ sessionId, agent, model }, null, 2);
  await fs.promises.writeFile(filePath, content, "utf-8");
}

export async function clearTaskSession(
  workspacePath: string,
  taskId: string,
  mode: PlanMode,
): Promise<void> {
  const filePath = sessionFilePath(workspacePath, taskId, mode);
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // File doesn't exist, ignore
  }
}

export interface ExecutionState {
  taskId: string;
  mode: PlanMode;
  status: "running" | "stopped";
  exitCode?: number | null;
}

export interface ActiveSession {
  taskId: string;
  mode: PlanMode;
  sessionName: string;
  agent: PlanAgent;
  model: string | null;
}

export async function getExecutionState(
  _taskId: string,
  _mode: PlanMode,
): Promise<ExecutionState | null> {
  return null;
}

export async function listActiveSessions(): Promise<ActiveSession[]> {
  return [];
}

export function startExecution(
  _taskId: string,
  _mode: PlanMode,
  _message: string,
  _agent: PlanAgent,
  _model: string | null,
  _options?: {
    workspacePath: string;
    taskFilePath: string;
    worktreePath?: string;
  },
): void {
  // Agent execution is handled by AgentRunner in agentService.ts
}

export function stopExecution(_taskId: string, _mode: PlanMode): void {
  // Agent execution is handled by AgentRunner in agentService.ts
}

export async function attachToSession(
  _taskId: string,
  _mode: PlanMode,
): Promise<boolean> {
  return false;
}
