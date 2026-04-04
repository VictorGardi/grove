import { ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import simpleGit from "simple-git";
import type {
  IpcResult,
  WorktreeInfo,
  SetupWorktreeInput,
  SetupWorktreeResult,
  TeardownWorktreeInput,
  DiffSummary,
  BranchInfo,
  FileTreeNode,
  FileReadResult,
} from "@shared/types";
import {
  listWorktrees,
  createWorktree,
  removeWorktree,
  deriveBranchName,
  WorktreeError,
  getDiff,
  getFileDiff,
  detectWorktreeBaseBranch,
  listBranches,
  buildFileTreeFromGitPaths,
  readFileAtBranch,
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

      // Copy task file into worktree so agent can access it (main repo may have uncommitted tasks)
      const relativeTaskFilePath = path.join(
        ".tasks",
        "doing",
        path.basename(taskFilePath),
      );
      const absoluteTaskDestPath = path.join(
        absoluteWorktreePath,
        ".tasks",
        "doing",
      );
      try {
        await fs.promises.mkdir(absoluteTaskDestPath, { recursive: true });
        await fs.promises.copyFile(
          taskFilePath,
          path.join(absoluteTaskDestPath, path.basename(taskFilePath)),
        );
      } catch (copyErr) {
        console.warn(
          "[git:setupWorktreeForTask] Task file copy failed:",
          copyErr,
        );
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
          taskFilePath: relativeTaskFilePath,
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

  // ── git:diff ──────────────────────────────────────────────────
  // Returns summary of changed files in a worktree branch vs base branch.
  ipcMain.handle(
    "git:diff",
    async (
      _event,
      worktreePath: string,
      baseBranch?: string,
    ): Promise<IpcResult<DiffSummary>> => {
      try {
        // Auto-detect base branch if not provided
        const base =
          baseBranch || (await detectWorktreeBaseBranch(worktreePath));
        const result = await getDiff(worktreePath, base);
        return {
          ok: true,
          data: {
            files: result.files.map((f) => ({
              path: f.path,
              status: f.status as "M" | "A" | "D" | "R",
              additions: f.additions,
              deletions: f.deletions,
            })),
            totalAdditions: result.totalAdditions,
            totalDeletions: result.totalDeletions,
          },
        };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // ── git:fileDiff ──────────────────────────────────────────────
  // Returns raw unified diff string for a single file.
  ipcMain.handle(
    "git:fileDiff",
    async (
      _event,
      worktreePath: string,
      filePath: string,
      baseBranch?: string,
    ): Promise<IpcResult<string>> => {
      try {
        const base =
          baseBranch || (await detectWorktreeBaseBranch(worktreePath));
        const diff = await getFileDiff(worktreePath, base, filePath);
        return { ok: true, data: diff };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // ── git:listBranches ──────────────────────────────────────────
  // Returns all local branches with worktree path if one exists.
  ipcMain.handle(
    "git:listBranches",
    async (_event, workspacePath: string): Promise<IpcResult<BranchInfo[]>> => {
      try {
        const branches = await listBranches(workspacePath);
        return { ok: true, data: branches };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // ── git:treeForBranch ─────────────────────────────────────────
  // Returns the file tree for a given branch (committed state).
  ipcMain.handle(
    "git:treeForBranch",
    async (
      _event,
      workspacePath: string,
      branch: string,
    ): Promise<IpcResult<FileTreeNode[]>> => {
      try {
        const git = simpleGit(workspacePath);
        const raw = await git.raw(["ls-tree", "-r", "--name-only", branch]);
        const filePaths = raw.trim().split("\n").filter(Boolean);
        const tree = buildFileTreeFromGitPaths(filePaths);
        return { ok: true, data: tree };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // ── git:readFileAtBranch ──────────────────────────────────────
  // Returns the committed content of a file from a specific branch.
  ipcMain.handle(
    "git:readFileAtBranch",
    async (
      _event,
      workspacePath: string,
      branch: string,
      relativePath: string,
    ): Promise<IpcResult<FileReadResult>> => {
      try {
        const result = await readFileAtBranch(
          workspacePath,
          branch,
          relativePath,
        );
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );
}
