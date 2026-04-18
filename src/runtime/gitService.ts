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
import { MAX_FILE_SIZE } from "@shared/fileUtils";
import { detectLanguage } from "@shared/language";

const ALWAYS_EXCLUDED = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
];

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

export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    const git = simpleGit(repoPath);
    const result = await git.revparse(["--is-inside-work-tree"]);
    return result.trim() === "true";
  } catch {
    return false;
  }
}

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
      terminalOpen: false,
    });
  }

  return results;
}

export function deriveBranchName(taskId: string, title: string): string {
  const idPart = taskId.toLowerCase();
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30)
    .replace(/-$/, "");
  return `feat/${idPart}-${slug || "task"}`;
}

export async function detectBaseBranch(
  repoPath: string,
): Promise<string | null> {
  const git = simpleGit(repoPath);

  try {
    await git.revparse(["HEAD"]);
  } catch {
    return null;
  }

  try {
    const raw = await git.revparse(["--abbrev-ref", "HEAD"]);
    const branch = raw.trim();
    if (branch && branch !== "HEAD") {
      return branch;
    }
  } catch {
    // ignore
  }

  try {
    const branches = await git.branchLocal();
    if (branches.all.includes("main")) return "main";
    if (branches.all.includes("master")) return "master";
  } catch {
    // ignore
  }

  return null;
}

export async function createWorktree(
  repoPath: string,
  taskId: string,
  branchName: string,
): Promise<string> {
  const git = simpleGit(repoPath);

  try {
    await git.revparse(["HEAD"]);
  } catch {
    throw new WorktreeError(
      "EMPTY_REPO",
      "Cannot create worktree: repository has no commits yet.",
    );
  }

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

  try {
    const existing = await listWorktrees(repoPath);
    const found = existing.find((w) => path.resolve(w.path) === absolutePath);
    if (found) {
      if (fs.existsSync(absolutePath)) {
        return absolutePath;
      }
      await git.raw(["worktree", "prune"]);
    }
  } catch {
    // proceed
  }

  if (fs.existsSync(worktreePath)) {
    const gitFile = path.join(worktreePath, ".git");
    if (!fs.existsSync(gitFile)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  }

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
      // no remote is fine
    }
  }

  try {
    if (branchExists) {
      await git.raw(["worktree", "add", worktreePath, branchName]);
    } else if (remoteBranchExists) {
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

  await ensureWorktreesIgnored(repoPath);

  return absolutePath;
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
): Promise<void> {
  const absolutePath = path.isAbsolute(worktreePath)
    ? worktreePath
    : path.resolve(repoPath, worktreePath);

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

export async function ensureWorktreesIgnored(repoPath: string): Promise<void> {
  const gitignorePath = path.join(repoPath, ".gitignore");
  let content = "";
  try {
    content = await fs.promises.readFile(gitignorePath, "utf-8");
  } catch {
    // file doesn't exist
  }
  if (content.includes(".worktrees/")) return;
  const append = content.endsWith("\n") ? ".worktrees/\n" : "\n.worktrees/\n";
  await fs.promises.appendFile(gitignorePath, append, "utf-8");
}

interface WorkspaceConfig {
  baseBranch?: string;
}

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

async function resolveRepoRoot(worktreePath: string): Promise<string> {
  const git = simpleGit(worktreePath);
  try {
    const raw = await git.raw([
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
    const gitDir = raw.trim();
    return path.dirname(gitDir);
  } catch {
    return worktreePath;
  }
}

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

  const isOnBaseBranch = mergeBase === headSha;
  const diffRef = isOnBaseBranch ? "HEAD" : `${mergeBase}...HEAD`;

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
      const filePath = parts.slice(2).join("\t");
      numstatMap.set(filePath, { additions, deletions });
    }
  }

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
    let status: string;
    if (rawStatus.startsWith("R")) {
      status = "R";
    } else if (rawStatus.startsWith("C")) {
      status = "M";
    } else {
      status = rawStatus;
    }

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

export async function getFileDiff(
  worktreePath: string,
  baseBranch: string,
  filePath: string,
): Promise<string> {
  const git = simpleGit(worktreePath);

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

export async function detectWorktreeBaseBranch(
  worktreePath: string,
): Promise<string> {
  const repoRoot = await resolveRepoRoot(worktreePath);
  const config = await readWorkspaceConfig(repoRoot);
  if (config.baseBranch) return config.baseBranch;

  const git = simpleGit(worktreePath);
  try {
    const branches = await git.branchLocal();
    if (branches.all.includes("main")) return "main";
    if (branches.all.includes("master")) return "master";
  } catch {
    // ignore
  }

  try {
    const remoteBranches = await git.branch(["-r"]);
    if (remoteBranches.all.some((b) => b.includes("origin/main")))
      return "origin/main";
    if (remoteBranches.all.some((b) => b.includes("origin/master")))
      return "origin/master";
  } catch {
    // no remote is fine
  }

  return "main";
}

export async function listBranches(repoPath: string): Promise<BranchInfo[]> {
  const git = simpleGit(repoPath);

  const localBranches = await git.branchLocal();

  let worktrees: WorktreeInfo[] = [];
  try {
    worktrees = await listWorktrees(repoPath);
  } catch {
    // not critical
  }

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

export function buildFileTreeFromGitPaths(filePaths: string[]): FileTreeNode[] {
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
      if (depth === 0 && ALWAYS_EXCLUDED.includes(name)) continue;

      const nodePath = currentPath ? `${currentPath}/${name}` : name;

      if (child.isFile && child.children.size === 0) {
        files.push({ name, path: nodePath, type: "file" });
      } else {
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

  if (raw.includes("\0")) {
    return { binary: true };
  }

  const byteSize = Buffer.byteLength(raw, "utf-8");
  if (byteSize > MAX_FILE_SIZE) {
    return { tooLarge: true, size: byteSize };
  }

  const filename = path.basename(relativePath);
  const language = detectLanguage(filename);
  const lineCount = raw.split("\n").length;

  return { content: raw, language, lineCount };
}
