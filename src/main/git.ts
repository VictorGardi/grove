import * as fs from "fs";
import * as path from "path";
import simpleGit from "simple-git";
import type { WorktreeInfo, WorktreeErrorCode } from "@shared/types";

// ── Error type ────────────────────────────────────────────────────

export class WorktreeError extends Error {
  constructor(
    public readonly code: WorktreeErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "WorktreeError";
  }
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Check if a directory is a git repository.
 */
export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    const git = simpleGit(repoPath);
    const result = await git.revparse(["--is-inside-work-tree"]);
    return result.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Parse `git worktree list --porcelain` output into WorktreeInfo objects.
 * Each entry looks like:
 *   worktree /abs/path
 *   HEAD abc123...
 *   branch refs/heads/feat/T-004  (or "detached" for detached HEAD)
 *   [bare]
 *   [locked]
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  try {
    const git = simpleGit(repoPath);
    const raw = await git.raw(["worktree", "list", "--porcelain"]);
    return parseWorktreePorcelain(raw, repoPath);
  } catch (err) {
    throw new WorktreeError(
      "NOT_A_REPO",
      `Failed to list worktrees: ${String(err)}`,
      err,
    );
  }
}

function parseWorktreePorcelain(raw: string, repoPath: string): WorktreeInfo[] {
  const results: WorktreeInfo[] = [];
  const entries = raw.trim().split(/\n\n+/);

  // Determine main worktree path so we can flag it
  const mainPath = path.resolve(repoPath);

  for (const entry of entries) {
    if (!entry.trim()) continue;

    const lines = entry.split("\n");
    const worktreeLine = lines.find((l) => l.startsWith("worktree "));
    const headLine = lines.find((l) => l.startsWith("HEAD "));
    const branchLine = lines.find((l) => l.startsWith("branch "));
    const isBare = lines.some((l) => l.trim() === "bare");
    const isDetached = lines.some((l) => l.trim() === "detached");

    if (!worktreeLine) continue;

    const wtPath = worktreeLine.slice("worktree ".length).trim();
    const head = headLine ? headLine.slice("HEAD ".length).trim() : "";
    const branch = branchLine
      ? branchLine.slice("branch ".length).trim()
      : null;
    const branchShort =
      branch && branch.startsWith("refs/heads/")
        ? branch.slice("refs/heads/".length)
        : branch
          ? branch
          : null;

    results.push({
      path: wtPath,
      head,
      branch,
      branchShort,
      isMain: path.resolve(wtPath) === mainPath,
      isBare,
      isDetached,
      terminalOpen: false, // Phase 6 wires this
    });
  }

  return results;
}

/**
 * Derive a git branch name from a task ID and title.
 * e.g. "T-004" + "JWT refresh token rotation" → "feat/t-004-jwt-refresh-token-r"
 */
export function deriveBranchName(taskId: string, title: string): string {
  const idPart = taskId.toLowerCase(); // "t-004"
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30)
    .replace(/-$/, "");
  return `feat/${idPart}-${slug || "task"}`;
}

/**
 * Detect the base branch for a repository.
 * Strategy: HEAD branch → 'main' (if exists) → 'master' → null (empty repo)
 */
export async function detectBaseBranch(
  repoPath: string,
): Promise<string | null> {
  const git = simpleGit(repoPath);

  // Check for empty repo (no commits)
  try {
    await git.revparse(["HEAD"]);
  } catch {
    return null; // empty repo
  }

  // Get the current HEAD branch name
  try {
    const raw = await git.revparse(["--abbrev-ref", "HEAD"]);
    const branch = raw.trim();
    if (branch && branch !== "HEAD") {
      return branch;
    }
  } catch {
    // ignore
  }

  // Fall back to main / master
  try {
    const branches = await git.branchLocal();
    if (branches.all.includes("main")) return "main";
    if (branches.all.includes("master")) return "master";
  } catch {
    // ignore
  }

  return null;
}

/**
 * Create a git worktree for a task. Idempotent:
 * - If .worktrees/<taskId> already exists and is a valid worktree → return existing path
 * - If branch exists locally → `git worktree add .worktrees/<taskId> <branch>` (no -b)
 * - If branch exists remotely only → `git worktree add ... -b <branch> --track origin/<branch>`
 * - If new → `git worktree add .worktrees/<taskId> -b <branchName>`
 *
 * Returns absolute worktree path.
 */
export async function createWorktree(
  repoPath: string,
  taskId: string,
  branchName: string,
): Promise<string> {
  const git = simpleGit(repoPath);

  // Check for empty repo
  try {
    await git.revparse(["HEAD"]);
  } catch {
    throw new WorktreeError(
      "EMPTY_REPO",
      "Cannot create worktree: repository has no commits yet.",
    );
  }

  // Check for detached HEAD
  const headRef = await git
    .revparse(["--abbrev-ref", "HEAD"])
    .catch(() => "HEAD");
  if (headRef.trim() === "HEAD") {
    throw new WorktreeError(
      "DETACHED_HEAD",
      "Repository is in detached HEAD state. Checkout a branch first.",
    );
  }

  const worktreePath = path.join(repoPath, ".worktrees", taskId);
  const absolutePath = path.resolve(worktreePath);

  // Idempotent: check if worktree already exists and is valid
  try {
    const existing = await listWorktrees(repoPath);
    const found = existing.find((w) => path.resolve(w.path) === absolutePath);
    if (found) {
      if (fs.existsSync(absolutePath)) {
        return absolutePath; // already exists and directory is on disk
      }
      // Stale git metadata: directory was deleted without `git worktree prune`.
      // Prune dead entries so we can recreate the worktree cleanly below.
      await git.raw(["worktree", "prune"]);
    }
  } catch {
    // proceed
  }

  // If the directory exists but isn't registered as a worktree, clean it up
  // and let it recreate (handles partial/failed previous attempts)
  if (fs.existsSync(worktreePath)) {
    const gitFile = path.join(worktreePath, ".git");
    if (!fs.existsSync(gitFile)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  }

  // Determine if branch exists locally or remotely
  let branchExists = false;
  let remoteBranchExists = false;

  try {
    const localBranches = await git.branchLocal();
    branchExists = localBranches.all.includes(branchName);
  } catch {
    // ignore
  }

  if (!branchExists) {
    try {
      const remoteBranches = await git.branch(["-r"]);
      remoteBranchExists = remoteBranches.all.some(
        (b) => b.trim() === `origin/${branchName}`,
      );
    } catch {
      // ignore — no remote is fine
    }
  }

  // Build git worktree add args
  try {
    if (branchExists) {
      // Branch exists locally — reuse it without -b
      await git.raw(["worktree", "add", worktreePath, branchName]);
    } else if (remoteBranchExists) {
      // Branch exists on remote — create local tracking branch
      await git.raw([
        "worktree",
        "add",
        worktreePath,
        "-b",
        branchName,
        "--track",
        `origin/${branchName}`,
      ]);
    } else {
      // New branch
      await git.raw(["worktree", "add", worktreePath, "-b", branchName]);
    }
  } catch (err) {
    const msg = String(err);
    if (msg.includes("already checked out")) {
      throw new WorktreeError(
        "BRANCH_LOCKED",
        "Branch already open in another worktree. Close it first.",
        err,
      );
    }
    if (msg.includes("is locked")) {
      throw new WorktreeError(
        "BRANCH_LOCKED",
        `Worktree is locked. Run \`git worktree unlock <path>\` in terminal.`,
        err,
      );
    }
    throw new WorktreeError(
      "UNKNOWN",
      `Failed to create worktree: ${msg}`,
      err,
    );
  }

  // Ensure .worktrees/ is in .gitignore
  await ensureWorktreesIgnored(repoPath);

  return absolutePath;
}

/**
 * Remove a git worktree. Uses --force to handle untracked files (e.g. CONTEXT.md).
 * Does NOT delete the branch.
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
): Promise<void> {
  const absolutePath = path.isAbsolute(worktreePath)
    ? worktreePath
    : path.resolve(repoPath, worktreePath);

  // If directory doesn't exist, treat as silent success
  if (!fs.existsSync(absolutePath)) {
    return;
  }

  const git = simpleGit(repoPath);

  try {
    await git.raw(["worktree", "remove", "--force", absolutePath]);
  } catch (err) {
    const msg = String(err);
    if (
      msg.includes("contains modified or untracked files") ||
      msg.includes("has modified files") ||
      msg.includes("dirty")
    ) {
      throw new WorktreeError(
        "DIRTY_WORKING_TREE",
        "Worktree has uncommitted changes. Commit or stash, then remove manually.",
        err,
      );
    }
    if (msg.includes("is locked")) {
      throw new WorktreeError(
        "BRANCH_LOCKED",
        `Worktree is locked. Run \`git worktree unlock <path>\` in terminal.`,
        err,
      );
    }
    throw new WorktreeError(
      "UNKNOWN",
      `Failed to remove worktree: ${msg}`,
      err,
    );
  }
}

/**
 * Ensure `.worktrees/` is listed in the repo's .gitignore.
 * Appended once on first worktree creation.
 */
export async function ensureWorktreesIgnored(repoPath: string): Promise<void> {
  const gitignorePath = path.join(repoPath, ".gitignore");
  let content = "";
  try {
    content = await fs.promises.readFile(gitignorePath, "utf-8");
  } catch {
    // file doesn't exist — will be created
  }
  if (content.includes(".worktrees/")) return;
  const append = content.endsWith("\n") ? ".worktrees/\n" : "\n.worktrees/\n";
  await fs.promises.appendFile(gitignorePath, append, "utf-8");
}
