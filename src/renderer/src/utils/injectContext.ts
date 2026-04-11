import type { TaskInfo } from "@shared/types";
import type { PromptConfig } from "../utils/planPrompts";
import {
  buildFirstExecutionMessage,
  buildFirstPlanMessage,
} from "../utils/planPrompts";
import { updateTask } from "../actions/taskActions";
import { showToast } from "../stores/useToastStore";

export interface InjectContextParams {
  sessionName: string;
  ptyId: string;
  task: TaskInfo;
  workspacePath: string;
  taskContent: string;
  sessionMode: "plan" | "exec";
  promptConfig: PromptConfig;
}

export async function injectExecutionContext(
  params: InjectContextParams,
): Promise<void> {
  const { sessionName, ptyId, task, taskContent, sessionMode, promptConfig } =
    params;

  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise<void>((r) => setTimeout(r, 500));
    const idleResult = await window.api.pty.isIdle(ptyId);
    if (idleResult.ok && idleResult.data === true) break;
    if (i === maxAttempts - 1) {
      console.error(
        `[injectExecutionContext] Timeout waiting for agent idle for session ${sessionName}`,
      );
      showToast(
        "Agent startup timed out — you may need to open the task panel",
        "warning",
      );
      return;
    }
  }

  let promptContent: string;
  if (sessionMode === "exec") {
    promptContent = buildFirstExecutionMessage(task, taskContent, promptConfig);
  } else {
    promptContent = buildFirstPlanMessage(
      task,
      "Please help me work on this task.",
      taskContent,
      promptConfig,
    );
  }

  const writeResult = await window.api.taskterm.writeContext({
    sessionName,
    content: promptContent,
  });
  if (!writeResult.ok || !writeResult.filePath) {
    console.error(
      `[injectExecutionContext] Failed to write context for session ${sessionName}`,
    );
    return;
  }

  window.api.pty.write(
    ptyId,
    `Please read ${writeResult.filePath} for your task context and instructions.`,
  );
  await new Promise<void>((r) => setTimeout(r, 300));
  window.api.pty.write(ptyId, "\r");

  await updateTask(task.filePath, { terminalExecContextSent: true });
}
