import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useDataStore } from "../stores/useDataStore";
import type { MilestoneFrontmatter } from "@shared/types";

function getWorkspacePath(): string | null {
  return useWorkspaceStore.getState().activeWorkspacePath;
}

export async function createMilestone(title: string): Promise<string | null> {
  const wp = getWorkspacePath();
  if (!wp) return null;
  const result = await window.api.milestones.create(wp, title);
  if (!result.ok) {
    console.error(
      "[milestoneActions] Failed to create milestone:",
      result.error,
    );
    return null;
  }
  useDataStore.getState().setSelectedMilestone(result.data.id);
  return result.data.id;
}

export async function updateMilestone(
  filePath: string,
  changes: Partial<MilestoneFrontmatter>,
  body?: string,
): Promise<boolean> {
  const wp = getWorkspacePath();
  if (!wp) return false;
  const result = await window.api.milestones.update(
    wp,
    filePath,
    changes,
    body,
  );
  if (!result.ok) {
    console.error(
      "[milestoneActions] Failed to update milestone:",
      result.error,
    );
    return false;
  }
  return true;
}
