import type { TaskInfo } from "@shared/types";
import { updateTask } from "../actions/taskActions";
import { showToast } from "../stores/useToastStore";

export interface InjectContextParams {
  sessionName: string;
  ptyId: string;
  task: TaskInfo;
  workspacePath: string;
  taskContent: string;
  sessionMode: "plan" | "exec";
  agent?: "opencode" | "copilot" | "claude";
}

const MARKER_PREFIX = "__GROVE_INJECT__";

function generateMarker(): string {
  return `${MARKER_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;
}

const AGENT_READY_SIGNALS: Record<string, RegExp[]> = {
  opencode: [/^>/m, /^➜/m, /Press/m, /Enter your message \(or '\/help'\)/m],
  copilot: [/^\s*>/m, /\$ /m, /^Copilot/m],
  claude: [/^>/m, /Input.*message/m],
};

function getReadySignal(agent: string): RegExp[] {
  return AGENT_READY_SIGNALS[agent] ?? AGENT_READY_SIGNALS.opencode;
}

async function waitForReady(
  ptyId: string,
  agent: string,
  timeout: number,
): Promise<boolean> {
  const startTime = Date.now();
  const signals = getReadySignal(agent);
  const pollInterval = 200;

  while (Date.now() - startTime < timeout) {
    const outputResult = await window.api.pty.getOutput(ptyId);
    if (outputResult.ok) {
      const output = outputResult.data;
      for (const signal of signals) {
        if (signal.test(output)) {
          return true;
        }
      }
    }
    await new Promise<void>((r) => setTimeout(r, pollInterval));
  }

  return false;
}

async function waitForMarker(
  ptyId: string,
  marker: string,
  timeout: number,
): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 100;

  while (Date.now() - startTime < timeout) {
    const outputResult = await window.api.pty.getOutput(ptyId);
    if (outputResult.ok && outputResult.data.includes(marker)) {
      return true;
    }
    await new Promise<void>((r) => setTimeout(r, pollInterval));
  }

  return false;
}

export async function injectExecutionContext(
  params: InjectContextParams,
): Promise<void> {
  const {
    sessionName,
    ptyId,
    task,
    workspacePath,
    sessionMode,
    agent = "opencode",
  } = params;

  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    window.api.pty.clearOutput(ptyId);

    const idleTimeout = 10000;
    const idleStart = Date.now();
    let idleCount = 0;
    while (Date.now() - idleStart < idleTimeout) {
      const idleResult = await window.api.pty.isIdle(ptyId);
      if (idleResult.ok && idleResult.data === true) {
        idleCount++;
        if (idleCount >= 3) break;
      }
      await new Promise<void>((r) => setTimeout(r, 500));
    }

    const idleElapsed = Date.now() - idleStart;

    if (idleElapsed >= idleTimeout) {
      console.error(`[injectContext:${ptyId}] Timeout waiting for agent idle`);
      if (attempt === maxRetries) {
        showToast(
          "Agent startup timed out — you may need to open the task panel",
          "warning",
        );
        await updateTask(task.filePath, { terminalExecContextSent: false });
        return;
      }
      continue;
    }

    await waitForReady(ptyId, agent, 5000);

    const stage = sessionMode === "exec" ? "execution" : "planning";
    const instructionsFile = sessionMode === "exec"
      ? ".grove/instructions/executor.md"
      : ".grove/instructions/planner.md";

    const preamble = `Task ID: ${task.id}
Stage: ${stage}
Task file: ${task.filePath}
Instructions: ${instructionsFile}`;

    const writeResult = await window.api.taskterm.writeContext({
      sessionName,
      content: preamble,
      workspacePath,
    });
    if (!writeResult.ok || !writeResult.filePath) {
      console.error(
        `[injectContext:${ptyId}] Failed to write context for session ${sessionName}`,
      );
      if (attempt === maxRetries) {
        return;
      }
      continue;
    }

    const marker = generateMarker();

    window.api.pty.write(ptyId, marker);
    await new Promise<void>((r) => setTimeout(r, 50));
    window.api.pty.write(ptyId, "\r");

    const markerAck = await waitForMarker(ptyId, marker, 3000);
    if (!markerAck) {
      console.warn(
        `[injectContext:${ptyId}] Marker not acknowledged, retrying`,
      );

      const retryDelay = 500 * attempt;
      await new Promise<void>((r) => setTimeout(r, retryDelay));
      continue;
    }

    const contextPath = writeResult.filePath;

    window.api.pty.write(
      ptyId,
      `Please read ${contextPath} for your task context and instructions.`,
    );
    await new Promise<void>((r) => setTimeout(r, 100));
    window.api.pty.write(ptyId, "\r");

    await updateTask(task.filePath, { terminalExecContextSent: true });
    return;
  }

  console.error(`[injectContext:${ptyId}] All ${maxRetries} attempts failed`);
  showToast("Failed to inject context — please check the terminal", "error");
  await updateTask(task.filePath, { terminalExecContextSent: false });
}
