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

// ── Phase 2: Tasks ───────────────────────────────────────────────

/** Status columns — maps to directory names in .tasks/ */
export type TaskStatus = "backlog" | "doing" | "review" | "done";

/** Supported agents for in-app planning */
export type PlanAgent = "opencode" | "copilot";

/** Mode for the plan/execution agent chat */
export type PlanMode = "plan" | "execute";

/** Parsed from a .tasks/{status}/T-XXX-slug.md file */
export interface TaskInfo {
  id: string;
  title: string;
  status: TaskStatus;
  agent: string | null;
  worktree: string | null;
  branch: string | null;
  created: string | null;
  tags: string[];
  decisions: string[];
  description: string;
  dodTotal: number;
  dodDone: number;
  filePath: string;
  /** Whether agent work should start automatically when task moves to doing. Default true. */
  autoRun: boolean;
  /** Session ID for in-app planning chat (persisted in frontmatter) */
  planSessionId: string | null;
  /** Which agent owns the current plan session */
  planSessionAgent: PlanAgent | null;
  /** Model used in the current plan session (e.g. "anthropic/claude-opus-4-5") */
  planModel: string | null;
  /** Session ID for execution agent chat (persisted in frontmatter) */
  execSessionId: string | null;
  /** Which agent owns the current execution session */
  execSessionAgent: PlanAgent | null;
  /** Model used in the current execution session */
  execModel: string | null;
}

/** Combined workspace data — returned atomically to avoid stale cross-references */
export interface WorkspaceData {
  tasks: TaskInfo[];
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

// ── Phase 4: Task CRUD ──────────────────────────────────────────

/** Partial frontmatter fields for task updates (read-merge-write pattern) */
export interface TaskFrontmatter {
  id: string;
  title: string;
  status: TaskStatus;
  agent: string | null;
  worktree: string | null;
  branch: string | null;
  created: string | null;
  tags: string[];
  decisions: string[];
  /** Only persisted when false; omitted (default true) otherwise */
  autoRun?: boolean;
  /** Session ID for in-app planning chat */
  planSessionId?: string | null;
  /** Which agent owns the current plan session */
  planSessionAgent?: PlanAgent | null;
  /** Model used in the current plan session */
  planModel?: string | null;
  /** Session ID for execution agent chat */
  execSessionId?: string | null;
  /** Which agent owns the current execution session */
  execSessionAgent?: PlanAgent | null;
  /** Model used in the current execution session */
  execModel?: string | null;
}

/** A single DoD checklist item parsed from the task body */
export interface DodItem {
  text: string;
  checked: boolean;
}

// ── Planning Chat ───────────────────────────────────────────────

/** A chunk of streamed output from the planning agent */
export interface PlanChunk {
  type: "text" | "thinking" | "session_id" | "done" | "error";
  content: string;
}

/** IPC envelope wrapping a chunk with routing metadata */
export interface PlanChunkEnvelope {
  taskId: string;
  mode: PlanMode;
  chunk: PlanChunk;
}

/** Role in a planning conversation */
export type PlanMessageRole = "user" | "agent";

/** A single message in the planning chat */
export interface PlanMessage {
  id: string;
  role: PlanMessageRole;
  text: string;
  thinking?: string;
  isStreaming: boolean;
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
  taskFilePath: string; // relative path to task in worktree, e.g. ".tasks/doing/T-012.md"
}

/** Input for git:teardownWorktreeForTask IPC handler */
export interface TeardownWorktreeInput {
  workspacePath: string;
  taskFilePath: string; // absolute path (already in .tasks/done/)
  worktreePath: string; // relative or absolute from frontmatter
}

// ── Branch listing (for Files branch selector) ───────────────────

/** A local git branch with optional worktree path */
export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  /** Absolute path to the worktree if one exists, null otherwise */
  worktreePath: string | null;
}

/** A single changed file in the diff summary */
export interface ChangedFile {
  path: string;
  status: "M" | "A" | "D" | "R";
  additions: number;
  deletions: number;
}

/** Result from git:diff — summary of all changed files */
export interface DiffSummary {
  files: ChangedFile[];
  totalAdditions: number;
  totalDeletions: number;
}
