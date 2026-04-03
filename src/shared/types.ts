/** Persisted in config.json */
export interface WorkspaceEntry {
  name: string; // Display label (directory basename)
  path: string; // Absolute path — unique identifier
}

/** Returned from workspace:list with runtime info */
export interface WorkspaceInfo extends WorkspaceEntry {
  branch: string | null; // Current git branch, null if not a git repo
  isGitRepo: boolean;
  exists: boolean; // false if directory no longer exists on disk
}

/** Persisted in config.json */
export interface AppConfig {
  workspaces: WorkspaceEntry[];
  lastActiveWorkspace: string | null; // workspace path
}

/** Standard IPC result wrapper */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Persisted in window-state.json */
export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

// ── Phase 2: Tasks & Milestones ──────────────────────────────────

/** Status columns — maps to directory names in .tasks/ */
export type TaskStatus = "backlog" | "doing" | "review" | "done";

/** Priority levels for task cards — optional frontmatter field */
export type TaskPriority = "critical" | "high" | "medium" | "low";

/** Parsed from a .tasks/{status}/T-XXX-slug.md file */
export interface TaskInfo {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  agent: string | null;
  worktree: string | null;
  branch: string | null;
  created: string | null;
  tags: string[];
  decisions: string[];
  milestone: string | null;
  description: string;
  dodTotal: number;
  dodDone: number;
  filePath: string;
}

/** Milestone status — binary */
export type MilestoneStatus = "open" | "closed";

/** Parsed from a .milestones/M-XXX-slug.md file */
export interface MilestoneInfo {
  id: string;
  title: string;
  status: MilestoneStatus;
  created: string | null;
  tags: string[];
  description: string;
  filePath: string;
  taskCounts: {
    total: number;
    done: number;
    doing: number;
    review: number;
    backlog: number;
  };
}

/** Combined workspace data — returned atomically to avoid stale cross-references */
export interface WorkspaceData {
  tasks: TaskInfo[];
  milestones: MilestoneInfo[];
}

// ── Phase 3: File Tree & Viewer ──────────────────────────────────

/** A node in the workspace file tree (recursive) */
export interface FileTreeNode {
  name: string;
  path: string; // relative to workspace root
  type: "file" | "directory";
  children?: FileTreeNode[];
}

/** Successfully read file content */
export interface FileContent {
  content: string;
  language: string;
  lineCount: number;
}

/** Possible results from reading a file */
export type FileReadResult =
  | FileContent
  | { binary: true }
  | { tooLarge: true; size: number };

// ── Phase 4: Task & Milestone CRUD ──────────────────────────────

/** Partial frontmatter fields for task updates (read-merge-write pattern) */
export interface TaskFrontmatter {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  agent: string | null;
  worktree: string | null;
  branch: string | null;
  created: string | null;
  tags: string[];
  decisions: string[];
  milestone: string | null;
}

/** Partial frontmatter fields for milestone updates */
export interface MilestoneFrontmatter {
  id: string;
  title: string;
  status: MilestoneStatus;
  created: string | null;
  tags: string[];
}

/** A single DoD checklist item parsed from the task body */
export interface DodItem {
  text: string;
  checked: boolean;
}

// ── Phase 5: Git Worktrees ──────────────────────────────────────

export type WorktreeErrorCode =
  | "NOT_A_REPO"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "BRANCH_LOCKED"
  | "DIRTY_WORKING_TREE"
  | "DETACHED_HEAD"
  | "EMPTY_REPO"
  | "GIT_NOT_FOUND"
  | "UNKNOWN";

/** Parsed from `git worktree list --porcelain` */
export interface WorktreeInfo {
  path: string; // absolute path
  head: string; // 40-char SHA
  branch: string | null; // "refs/heads/feat/T-004" or null if detached
  branchShort: string | null; // "feat/T-004"
  isMain: boolean;
  isBare: boolean;
  isDetached: boolean;
  terminalOpen: boolean; // always false in Phase 5; wired in Phase 6
}

/** Display-ready item for the sidebar worktree list */
export interface WorktreeDisplayItem {
  taskId: string;
  taskTitle: string;
  branch: string;
  worktreePath: string;
  terminalOpen: boolean;
}

/** Input for the orchestrating git:setupWorktreeForTask IPC handler */
export interface SetupWorktreeInput {
  workspacePath: string;
  taskFilePath: string; // absolute path to .md (already in .tasks/doing/)
  taskId: string;
  taskTitle: string;
}

/** Result from git:setupWorktreeForTask */
export interface SetupWorktreeResult {
  worktreePath: string; // relative, e.g. ".worktrees/T-004"
  branchName: string;
  alreadyExisted: boolean;
}

/** Input for git:teardownWorktreeForTask IPC handler */
export interface TeardownWorktreeInput {
  workspacePath: string;
  taskFilePath: string; // absolute path (already in .tasks/done/)
  worktreePath: string; // relative or absolute from frontmatter
}
