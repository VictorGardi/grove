import * as fs from "fs";
import * as path from "path";
import simpleGit from "simple-git";
import type {
  WorktreeInfo,
  WorktreeErrorCode,
  BranchInfo,
  FileTreeNode,
  FileReadResult,
} from "@shared/types";
import { ALWAYS_EXCLUDED } from "./filesystem";
import { detectLanguage } from "@shared/language";
import { MAX_FILE_SIZE } from "@shared/fileUtils";

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

// ── Phase 7: Diff helpers ────────────────────────────────────────

/**
 * Workspace-level config stored in <repo>/.grove/config.json
 */
interface WorkspaceConfig {
  baseBranch?: string;
}

/**
 * Read workspace-level config from <workspacePath>/.grove/config.json.
 * Returns empty config on any error (missing file, malformed JSON, etc.)
 */
async function readWorkspaceConfig(
  workspacePath: string,
): Promise<WorkspaceConfig> {
  const configPath = path.join(workspacePath, ".grove", "config.json");
  try {
    const raw = await fs.promises.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Resolve the main repository root from a worktree path.
 * Uses `git rev-parse --git-common-dir` to find the shared .git directory,
 * then derives the repo root from that.
 */
async function resolveRepoRoot(worktreePath: string): Promise<string> {
  const git = simpleGit(worktreePath);
  try {
    const raw = await git.raw([
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
    // git-common-dir returns the .git dir of the main repo (e.g. /repo/.git)
    const gitDir = raw.trim();
    return path.dirname(gitDir);
  } catch {
    return worktreePath; // fallback: assume we're already at repo root
  }
}

/**
 * Get a summary of changed files in a worktree branch vs the base branch.
 * Uses `git merge-base` to find the true divergence point — only shows
 * what this branch added, not unrelated commits on the base.
 */
export async function getDiff(
  worktreePath: string,
  baseBranch: string,
): Promise<{
  files: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
  }>;
  totalAdditions: number;
  totalDeletions: number;
}> {
  const git = simpleGit(worktreePath);

  // Find the merge-base (common ancestor)
  let mergeBase: string;
  let headSha: string;
  try {
    const raw = await git.raw(["merge-base", "HEAD", baseBranch]);
    mergeBase = raw.trim();
  } catch (err) {
    throw new WorktreeError(
      "UNKNOWN",
      `Failed to find merge-base between HEAD and ${baseBranch}: ${String(err)}`,
      err,
    );
  }
  try {
    headSha = (await git.raw(["rev-parse", "HEAD"])).trim();
  } catch {
    headSha = "";
  }

  // If merge-base equals HEAD (e.g. on the base branch itself), show working
  // tree changes against HEAD instead of an empty branch diff.
  const isOnBaseBranch = mergeBase === headSha;
  const diffRef = isOnBaseBranch ? "HEAD" : `${mergeBase}...HEAD`;

  // Get name-status for file list
  let nameStatusRaw: string;
  try {
    nameStatusRaw = await git.raw(["diff", "--name-status", diffRef]);
  } catch (err) {
    throw new WorktreeError(
      "UNKNOWN",
      `Failed to get diff name-status: ${String(err)}`,
      err,
    );
  }

  // Get numstat for additions/deletions per file
  let numstatRaw: string;
  try {
    numstatRaw = await git.raw(["diff", "--numstat", diffRef]);
  } catch (err) {
    throw new WorktreeError(
      "UNKNOWN",
      `Failed to get diff numstat: ${String(err)}`,
      err,
    );
  }

  // Parse numstat into a map: filePath → { additions, deletions }
  const numstatMap = new Map<
    string,
    { additions: number; deletions: number }
  >();
  for (const line of numstatRaw.trim().split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length >= 3) {
      const additions = parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
      const deletions = parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
      const filePath = parts.slice(2).join("\t"); // handle paths with tabs (rare)
      numstatMap.set(filePath, { additions, deletions });
    }
  }

  // Parse name-status and build result
  const files: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
  }> = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const line of nameStatusRaw.trim().split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;

    const rawStatus = parts[0].trim();
    // Normalize status: R100 → R, C100 → M, etc.
    let status: string;
    if (rawStatus.startsWith("R")) {
      status = "R";
    } else if (rawStatus.startsWith("C")) {
      status = "M";
    } else {
      status = rawStatus;
    }

    // For renames, the path is the destination (second path)
    const filePath = status === "R" ? parts[2] || parts[1] : parts[1];
    const stats = numstatMap.get(filePath) || { additions: 0, deletions: 0 };

    files.push({
      path: filePath,
      status,
      additions: stats.additions,
      deletions: stats.deletions,
    });

    totalAdditions += stats.additions;
    totalDeletions += stats.deletions;
  }

  return { files, totalAdditions, totalDeletions };
}

/**
 * Get the raw unified diff for a single file in a worktree branch vs base.
 */
export async function getFileDiff(
  worktreePath: string,
  baseBranch: string,
  filePath: string,
): Promise<string> {
  const git = simpleGit(worktreePath);

  // Find the merge-base
  let mergeBase: string;
  let headSha: string;
  try {
    const raw = await git.raw(["merge-base", "HEAD", baseBranch]);
    mergeBase = raw.trim();
  } catch (err) {
    throw new WorktreeError(
      "UNKNOWN",
      `Failed to find merge-base: ${String(err)}`,
      err,
    );
  }
  try {
    headSha = (await git.raw(["rev-parse", "HEAD"])).trim();
  } catch {
    headSha = "";
  }

  const isOnBaseBranch = mergeBase === headSha;
  const diffRef = isOnBaseBranch ? "HEAD" : `${mergeBase}...HEAD`;

  // Get unified diff for this file
  try {
    const diff = await git.raw(["diff", diffRef, "--", filePath]);
    return diff;
  } catch (err) {
    throw new WorktreeError(
      "UNKNOWN",
      `Failed to get file diff: ${String(err)}`,
      err,
    );
  }
}

/**
 * Detect the base branch for a worktree.
 * Priority:
 *   1. Workspace config (.grove/config.json baseBranch)
 *   2. Local branch detection (main/master)
 *   3. Remote branch detection (origin/main, origin/master)
 *   4. Fallback to "main"
 */
export async function detectWorktreeBaseBranch(
  worktreePath: string,
): Promise<string> {
  // 1. Check workspace config for baseBranch override
  const repoRoot = await resolveRepoRoot(worktreePath);
  const config = await readWorkspaceConfig(repoRoot);
  if (config.baseBranch) return config.baseBranch;

  // 2. Try to find main or master branch locally
  const git = simpleGit(worktreePath);
  try {
    const branches = await git.branchLocal();
    if (branches.all.includes("main")) return "main";
    if (branches.all.includes("master")) return "master";
  } catch {
    // ignore
  }

  // 3. Try remote
  try {
    const remoteBranches = await git.branch(["-r"]);
    if (remoteBranches.all.some((b) => b.includes("origin/main")))
      return "origin/main";
    if (remoteBranches.all.some((b) => b.includes("origin/master")))
      return "origin/master";
  } catch {
    // ignore — no remote is fine
  }

  // 4. Last resort fallback
  return "main";
}

// ── Branch listing (for Files branch selector) ────────────────────

/**
 * List all local branches with worktree path if one exists.
 */
export async function listBranches(repoPath: string): Promise<BranchInfo[]> {
  const git = simpleGit(repoPath);

  // Get all local branches
  const localBranches = await git.branchLocal();

  // Get worktrees to cross-reference
  let worktrees: WorktreeInfo[] = [];
  try {
    worktrees = await listWorktrees(repoPath);
  } catch {
    // not critical
  }

  // Build a map: branchShort → absolute worktree path
  const worktreeMap = new Map<string, string>();
  for (const wt of worktrees) {
    if (wt.branchShort && !wt.isMain) {
      worktreeMap.set(wt.branchShort, wt.path);
    }
  }

  const results: BranchInfo[] = [];
  for (const name of localBranches.all) {
    results.push({
      name,
      isCurrent: name === localBranches.current,
      worktreePath: worktreeMap.get(name) ?? null,
    });
  }

  return results;
}

/**
 * Build a FileTreeNode[] hierarchy from a flat list of git-tracked paths.
 * Filters top-level names against ALWAYS_EXCLUDED, sorts dirs before files.
 */
export function buildFileTreeFromGitPaths(filePaths: string[]): FileTreeNode[] {
  // Trie: map from name → { children map, isFile }
  interface TrieNode {
    children: Map<string, TrieNode>;
    isFile: boolean;
  }

  const root: TrieNode = { children: new Map(), isFile: false };

  for (const filePath of filePaths) {
    const parts = filePath.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      if (!node.children.has(part)) {
        node.children.set(part, { children: new Map(), isFile: false });
      }
      node = node.children.get(part)!;
      if (i === parts.length - 1) {
        node.isFile = true;
      }
    }
  }

  const sortFn = (a: FileTreeNode, b: FileTreeNode): number =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase());

  function trieToNodes(
    trieNode: TrieNode,
    currentPath: string,
    depth: number,
  ): FileTreeNode[] {
    const dirs: FileTreeNode[] = [];
    const files: FileTreeNode[] = [];

    for (const [name, child] of trieNode.children) {
      // Filter ALWAYS_EXCLUDED at any depth level that makes sense
      if (depth === 0 && ALWAYS_EXCLUDED.includes(name)) continue;

      const nodePath = currentPath ? `${currentPath}/${name}` : name;

      if (child.isFile && child.children.size === 0) {
        files.push({ name, path: nodePath, type: "file" });
      } else {
        // Directory (may also have isFile if git has a file and dir with same name — rare)
        const children = trieToNodes(child, nodePath, depth + 1);
        dirs.push({ name, path: nodePath, type: "directory", children });
      }
    }

    dirs.sort(sortFn);
    files.sort(sortFn);
    return [...dirs, ...files];
  }

  return trieToNodes(root, "", 0);
}

/**
 * Read a file from a specific git branch (committed state).
 * Uses `git show <branch>:<relativePath>`.
 */
export async function readFileAtBranch(
  repoPath: string,
  branch: string,
  relativePath: string,
): Promise<FileReadResult> {
  const git = simpleGit(repoPath);

  let raw: string;
  try {
    raw = await git.raw(["show", `${branch}:${relativePath}`]);
  } catch (err) {
    throw new WorktreeError(
      "NOT_FOUND",
      `Cannot read ${relativePath} from branch ${branch}: ${String(err)}`,
      err,
    );
  }

  // Binary detection: check for null bytes
  if (raw.includes("\0")) {
    return { binary: true };
  }

  // Size check
  const byteSize = Buffer.byteLength(raw, "utf-8");
  if (byteSize > MAX_FILE_SIZE) {
    return { tooLarge: true, size: byteSize };
  }

  const filename = path.basename(relativePath);
  const language = detectLanguage(filename);
  const lineCount = raw.split("\n").length;

  return { content: raw, language, lineCount };
}
