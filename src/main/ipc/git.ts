import { ipcMain } from "electron";
import * as path from "path";
import type {
  IpcResult,
  WorktreeInfo,
  SetupWorktreeInput,
  SetupWorktreeResult,
  TeardownWorktreeInput,
} from "@shared/types";
import {
  listWorktrees,
  createWorktree,
  removeWorktree,
  deriveBranchName,
  WorktreeError,
} from "../git";
import { updateTask, readTaskBody, parseTaskFile } from "../tasks";
import { generateContextFile } from "../contextGenerator";

export function registerGitHandlers(): void {
  // ── git:listWorktrees ─────────────────────────────────────────
  ipcMain.handle(
    "git:listWorktrees",
    async (_event, repoPath: string): Promise<IpcResult<WorktreeInfo[]>> => {
      try {
        const worktrees = await listWorktrees(repoPath);
        return { ok: true, data: worktrees };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // ── git:createWorktree ────────────────────────────────────────
  ipcMain.handle(
    "git:createWorktree",
    async (
      _event,
      repoPath: string,
      taskId: string,
      branchName: string,
    ): Promise<IpcResult<{ worktreePath: string; branchName: string }>> => {
      try {
        const worktreePath = await createWorktree(repoPath, taskId, branchName);
        return { ok: true, data: { worktreePath, branchName } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // ── git:removeWorktree ────────────────────────────────────────
  ipcMain.handle(
    "git:removeWorktree",
    async (
      _event,
      repoPath: string,
      worktreePath: string,
    ): Promise<IpcResult<void>> => {
      try {
        await removeWorktree(repoPath, worktreePath);
        return { ok: true, data: undefined };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // ── git:setupWorktreeForTask ──────────────────────────────────
  // Orchestrating handler: move to doing already happened before this is called.
  // This handler:
  //   1. Derives branch name from taskId + title
  //   2. Creates worktree (idempotent)
  //   3. Reads task body from disk
  //   4. Generates CONTEXT.md
  //   5. Updates frontmatter with worktree + branch fields
  //   6. Returns result
  ipcMain.handle(
    "git:setupWorktreeForTask",
    async (
      _event,
      input: SetupWorktreeInput,
    ): Promise<IpcResult<SetupWorktreeResult>> => {
      const { workspacePath, taskFilePath, taskId, taskTitle } = input;

      // Derive branch name
      const branchName = deriveBranchName(taskId, taskTitle);
      const relativeWorktreePath = path.join(".worktrees", taskId);

      // Check idempotent: does worktree already exist?
      let alreadyExisted = false;
      try {
        const existing = await listWorktrees(workspacePath);
        const absoluteTarget = path.resolve(
          workspacePath,
          relativeWorktreePath,
        );
        alreadyExisted = existing.some(
          (w) => path.resolve(w.path) === absoluteTarget,
        );
      } catch {
        // not a git repo or listing failed — handle below
      }

      // Create worktree (or verify existing)
      let absoluteWorktreePath: string;
      try {
        absoluteWorktreePath = await createWorktree(
          workspacePath,
          taskId,
          branchName,
        );
      } catch (err) {
        if (err instanceof WorktreeError) {
          return { ok: false, error: `[${err.code}] ${err.message}` };
        }
        return { ok: false, error: String(err) };
      }

      // Generate CONTEXT.md — failure is non-blocking (warn, don't fail)
      try {
        const taskBody = await readTaskBody(workspacePath, taskFilePath);
        // Re-parse to get fresh TaskInfo (status is now "doing")
        const taskInfo = await parseTaskFile(taskFilePath, "doing");
        if (taskInfo) {
          // Attach the branch name we just derived (frontmatter not updated yet)
          await generateContextFile(
            absoluteWorktreePath,
            { ...taskInfo, branch: branchName, worktree: relativeWorktreePath },
            taskBody,
            workspacePath,
          );
        }
      } catch (ctxErr) {
        console.warn(
          "[git:setupWorktreeForTask] CONTEXT.md write failed:",
          ctxErr,
        );
        // Non-fatal: worktree was created, we just warn
      }

      // Update task frontmatter with worktree + branch — failure is non-blocking
      try {
        await updateTask(workspacePath, taskFilePath, {
          worktree: relativeWorktreePath,
          branch: branchName,
        });
      } catch (updateErr) {
        console.warn(
          "[git:setupWorktreeForTask] Frontmatter update failed:",
          updateErr,
        );
        // Non-fatal: return success with the correct paths so UI can patch in-memory
      }

      return {
        ok: true,
        data: {
          worktreePath: relativeWorktreePath,
          branchName,
          alreadyExisted,
        },
      };
    },
  );

  // ── git:teardownWorktreeForTask ───────────────────────────────
  // Called after task has been moved to Done.
  // Removes the worktree, then clears worktree + branch from frontmatter.
  ipcMain.handle(
    "git:teardownWorktreeForTask",
    async (_event, input: TeardownWorktreeInput): Promise<IpcResult<void>> => {
      const { workspacePath, taskFilePath, worktreePath } = input;

      // Resolve absolute path
      const absolutePath = path.isAbsolute(worktreePath)
        ? worktreePath
        : path.resolve(workspacePath, worktreePath);

      // Remove worktree
      try {
        await removeWorktree(workspacePath, absolutePath);
      } catch (err) {
        // Return error — task stays in Done but worktree field NOT cleared
        return { ok: false, error: String(err) };
      }

      // Clear worktree + branch from frontmatter
      try {
        await updateTask(workspacePath, taskFilePath, {
          worktree: null,
          branch: null,
        });
      } catch (updateErr) {
        console.warn(
          "[git:teardownWorktreeForTask] Frontmatter clear failed:",
          updateErr,
        );
        // Non-fatal: worktree is gone, just log
      }

      return { ok: true, data: undefined };
    },
  );
}
