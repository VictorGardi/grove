import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useDataStore } from "../stores/useDataStore";
import { useWorktreeStore } from "../stores/useWorktreeStore";
import { usePlanStore } from "../stores/usePlanStore";
import { useDialogStore } from "../stores/useDialogStore";
import {
  useLaunchModalStore,
  type LaunchConfig,
} from "../stores/useLaunchModalStore";
import { showToast } from "../stores/useToastStore";
import type { TaskInfo } from "@shared/types";
import { moveTask, updateTask } from "./taskActions";
import { injectExecutionContext } from "../utils/injectContext";

function worktreeErrorMessage(error: string): string {
  if (error.includes("[NOT_A_REPO]"))
    return "This workspace is not a git repository. Worktree creation skipped.";
  if (error.includes("[GIT_NOT_FOUND]"))
    return "git not found. Install git and restart Grove.";
  if (error.includes("[EMPTY_REPO]"))
    return "Cannot create worktree: repository has no commits yet.";
  if (error.includes("[BRANCH_LOCKED]"))
    return "Branch already open in another worktree. Close it first.";
  if (error.includes("[ALREADY_EXISTS]"))
    return "Worktree directory exists but is not valid. Remove .worktrees/ manually.";
  if (error.includes("[DETACHED_HEAD]"))
    return "Repository is in detached HEAD state. Checkout a branch first.";
  return `Failed to create worktree: ${error}`;
}

const NOROLLBACK_CODES = new Set([
  "NOT_A_REPO",
  "GIT_NOT_FOUND",
  "EMPTY_REPO",
  "ALREADY_EXISTS",
  "DETACHED_HEAD",
]);

function shouldRollback(error: string): boolean {
  for (const code of NOROLLBACK_CODES) {
    if (error.includes(`[${code}]`)) return false;
  }
  return true;
}

export async function startTaskExecution(
  task: TaskInfo,
  config: LaunchConfig,
): Promise<void> {
  const wp = useWorkspaceStore.getState().activeWorkspacePath;
  if (!wp) return;

  await updateTask(task.filePath, {
    execSessionAgent: config.agent,
    execModel: config.model,
    useWorktree: config.useWorktree,
  });

  const currentTask =
    useDataStore.getState().tasks.find((t) => t.id === task.id) ?? task;

  const moveOk = await moveTask(currentTask.filePath, "doing");
  if (!moveOk) {
    showToast(`Failed to move task: ${task.title}`, "error");
    return;
  }

  let movedTask =
    useDataStore.getState().tasks.find((t) => t.id === task.id) ?? currentTask;

  if (movedTask.terminalExecSession) {
    const execPtyId = `taskterm-exec-${task.id}`;
    await window.api.taskterm.kill({
      ptyId: execPtyId,
      sessionName: movedTask.terminalExecSession,
    });
    await updateTask(movedTask.filePath, {
      terminalExecSession: null,
      terminalExecContextSent: false,
    });
    movedTask =
      useDataStore.getState().tasks.find((t) => t.id === task.id) ?? movedTask;
  }

  if (movedTask.terminalPlanSession) {
    const planPtyId = `taskterm-plan-${task.id}`;
    await window.api.taskterm.kill({
      ptyId: planPtyId,
      sessionName: movedTask.terminalPlanSession,
    });
    await updateTask(movedTask.filePath, { terminalPlanSession: null });
    movedTask =
      useDataStore.getState().tasks.find((t) => t.id === task.id) ?? movedTask;
  }

  let worktreeAbsPath: string | undefined;

  if (config.useWorktree !== false) {
    useWorktreeStore.getState().markCreating(task.id);

    const result = await window.api.git.setupWorktreeForTask({
      workspacePath: wp,
      taskFilePath: movedTask.filePath,
      taskId: task.id,
      taskTitle: task.title,
    });

    useWorktreeStore.getState().markCreated(task.id);

    if (!result.ok) {
      if (shouldRollback(result.error)) {
        await moveTask(movedTask.filePath, task.status);
      }
      showToast(worktreeErrorMessage(result.error), "error");
      return;
    }

    useDataStore.getState().patchTask({
      ...movedTask,
      status: "doing",
      worktree: result.data.worktreePath,
      branch: result.data.branchName,
    });

    if (!result.data.alreadyExisted) {
      showToast(`Worktree created: ${result.data.branchName}`, "success");
    }

    const wtp = result.data.worktreePath;
    worktreeAbsPath = wtp.startsWith("/") ? wtp : `${wp}/${wtp}`;
  }

  const execSessionKey = `execute:${task.id}`;
  const isRunning =
    usePlanStore.getState().sessions[execSessionKey]?.isRunning ?? false;
  if (isRunning) return;

  const latestTask =
    useDataStore.getState().tasks.find((t) => t.id === task.id) ?? movedTask;

  const agent = config.agent;
  const model = config.model;

  const rawResult = await window.api.tasks.readRaw(wp, latestTask.filePath);
  if (!rawResult.ok) {
    showToast("Could not read task file — execution not started", "error");
    return;
  }

  const cwd = worktreeAbsPath ?? wp;
  const createResult = await window.api.taskterm.create({
    ptyId: `taskterm-exec-${task.id}`,
    taskId: task.id,
    agent,
    model,
    cwd,
    sessionMode: "exec",
    taskFilePath: latestTask.filePath,
    workspacePath: wp,
  });

  if (!createResult.ok) {
    showToast(`Execution failed to start: ${createResult.error}`, "error");
    return;
  }

  await updateTask(latestTask.filePath, { terminalExecContextSent: false });

  const sessionName = createResult.sessionName;
  if (sessionName) {
    const workspaceDefaults =
      useWorkspaceStore.getState().workspaceDefaults[wp] ?? {};
    await injectExecutionContext({
      sessionName,
      ptyId: `taskterm-exec-${task.id}`,
      task: latestTask,
      workspacePath: wp,
      taskContent:
        rawResult.data ??
        `# ${latestTask.title}\n\n${latestTask.description ?? ""}`,
      sessionMode: "exec",
      promptConfig: {
        planPersona: workspaceDefaults.planPersona,
        planReviewPersona: workspaceDefaults.planReviewPersona,
        executePersona: workspaceDefaults.executePersona,
        executeReviewPersona: workspaceDefaults.executeReviewPersona,
        executeReviewInstructions: workspaceDefaults.executeReviewInstructions,
      },
    });
  }
}

export async function showLaunchModalAndExecute(task: TaskInfo): Promise<void> {
  const wp = useWorkspaceStore.getState().activeWorkspacePath;
  if (!wp) return;

  if (task.terminalExecSession) return;

  await useWorkspaceStore.getState().fetchDefaults(wp);

  const config = await useLaunchModalStore.getState().show(task);
  if (config === null) return;

  await startTaskExecution(task, config);
}

export async function completeTask(task: TaskInfo): Promise<void> {
  const wp = useWorkspaceStore.getState().activeWorkspacePath;
  if (!wp) return;

  if (task.worktree) {
    const confirmed = await useDialogStore.getState().show({
      title: "Remove worktree?",
      message: `The branch "${task.branch ?? "(unknown)"}" will be kept.\nThe working tree at ${task.worktree} will be deleted.`,
      confirmLabel: "Remove worktree",
      cancelLabel: "Keep worktree",
    });

    if (!confirmed) return;
  }

  useDataStore.getState().patchTask({ ...task, status: "done" });
  const moveOk = await moveTask(task.filePath, "done");
  if (!moveOk) {
    useDataStore.getState().patchTask(task);
    showToast("Failed to move task to Done", "error");
    return;
  }

  let movedTask = useDataStore
    .getState()
    .tasks.find((t) => t.id === task.id) ?? {
    ...task,
    status: "done",
  };

  if (movedTask.terminalExecSession) {
    const execPtyId = `taskterm-exec-${task.id}`;
    await window.api.taskterm.kill({
      ptyId: execPtyId,
      sessionName: movedTask.terminalExecSession,
    });
    await updateTask(movedTask.filePath, { terminalExecSession: null });
    movedTask =
      useDataStore.getState().tasks.find((t) => t.id === task.id) ?? movedTask;
  }

  if (movedTask.terminalPlanSession) {
    const planPtyId = `taskterm-plan-${task.id}`;
    await window.api.taskterm.kill({
      ptyId: planPtyId,
      sessionName: movedTask.terminalPlanSession,
    });
    await updateTask(movedTask.filePath, { terminalPlanSession: null });
  }

  if (task.worktree) {
    const result = await window.api.git.teardownWorktreeForTask({
      workspacePath: wp,
      taskFilePath: movedTask.filePath,
      worktreePath: task.worktree,
    });

    if (!result.ok) {
      if (result.error.includes("DIRTY_WORKING_TREE")) {
        showToast(
          "Worktree has uncommitted changes. Commit or stash, then remove manually.",
          "warning",
        );
      } else {
        showToast(
          `Task done, but worktree removal failed: ${result.error}`,
          "warning",
        );
      }
      return;
    }

    useDataStore
      .getState()
      .patchTask({ ...movedTask, worktree: null, branch: null });
  }
}
