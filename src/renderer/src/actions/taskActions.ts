import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useDataStore } from "../stores/useDataStore";
import type { TaskStatus, TaskFrontmatter } from "@shared/types";

function getWorkspacePath(): string | null {
  return useWorkspaceStore.getState().activeWorkspacePath;
}

export async function createTask(title: string): Promise<string | null> {
  const wp = getWorkspacePath();
  if (!wp) return null;
  const result = await window.api.tasks.create(wp, title);
  if (!result.ok) {
    console.error("[taskActions] Failed to create task:", result.error);
    return null;
  }
  // Patch the store immediately with confirmed disk state — no chokidar wait
  useDataStore.getState().patchTask(result.data);
  useDataStore.getState().setSelectedTask(result.data.id);
  return result.data.id;
}

export async function updateTask(
  filePath: string,
  changes: Partial<TaskFrontmatter>,
  body?: string,
): Promise<boolean> {
  const wp = getWorkspacePath();
  if (!wp) {
    console.error("[taskActions] updateTask: no active workspace");
    return false;
  }
  console.log("[taskActions] updateTask:", {
    filePath,
    changes,
    bodyLen: body?.length,
  });
  const result = await window.api.tasks.update(wp, filePath, changes, body);
  if (!result.ok) {
    console.error("[taskActions] Failed to update task:", result.error);
    return false;
  }
  // Patch the store immediately with confirmed disk state — no chokidar wait
  useDataStore.getState().patchTask(result.data);
  return true;
}

export async function moveTask(
  filePath: string,
  toStatus: TaskStatus,
): Promise<boolean> {
  const wp = getWorkspacePath();
  if (!wp) return false;
  const result = await window.api.tasks.move(wp, filePath, toStatus);
  if (!result.ok) {
    console.error("[taskActions] Failed to move task:", result.error);
    return false;
  }
  // Patch the store immediately with confirmed disk state — no chokidar wait
  useDataStore.getState().patchTask(result.data);
  return true;
}

export async function archiveTask(filePath: string): Promise<boolean> {
  const wp = getWorkspacePath();
  if (!wp) return false;
  const result = await window.api.tasks.archive(wp, filePath);
  if (!result.ok) {
    console.error("[taskActions] Failed to archive task:", result.error);
    return false;
  }
  useDataStore.getState().clearSelectedTask();
  return true;
}
