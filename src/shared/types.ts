/** Persisted in config.json */
export interface WorkspaceEntry {
  name: string; // Display label (directory basename)
  path: string; // Absolute path — unique identifier
  /** Default agent for planning sessions */
  defaultPlanningAgent?: PlanAgent;
  /** Default model for planning sessions */
  defaultPlanningModel?: string;
  /** Default agent for execution sessions */
  defaultExecutionAgent?: PlanAgent;
  /** Default model for execution sessions */
  defaultExecutionModel?: string;
  /** Custom persona for planning agent */
  planPersona?: string;
  /** Custom persona for plan reviewer */
  planReviewPersona?: string;
  /** Custom persona for execution agent */
  executePersona?: string;
  /** Custom persona for execution reviewer */
  executeReviewPersona?: string;
  /** Custom instructions for execution review phase */
  executeReviewInstructions?: string;
  /** Hide workspace tasks from views */
  hidden?: boolean;
  /** Enable containerized execution for this workspace */
  containerEnabled?: boolean;
  /** Container runtime to use (docker or podman) */
  containerRuntime?: ContainerRuntime;
  /** Default image to use when no devcontainer.json exists */
  containerDefaultImage?: string;
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
  theme: string;
  windowOpacity: number;
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

/** Status columns — maps to directory names in .grove/tasks/ */
export type TaskStatus = "backlog" | "doing" | "review" | "done";

/** Supported agents for in-app planning */
export type PlanAgent = "opencode" | "copilot" | "claude";

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
  decisions: string[];
  description: string;
  dodTotal: number;
  dodDone: number;
  filePath: string;
  /** Absolute path of the workspace this task belongs to */
  workspacePath: string;
  /** When false the agent runs in the workspace root instead of a dedicated
   *  git worktree. Default true. */
  useWorktree: boolean;
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
  /** Tmux session name for planning terminal session (persisted in frontmatter) */
  terminalPlanSession: string | null;
  /** Tmux session name for execution terminal session (persisted in frontmatter) */
  terminalExecSession: string | null;
  /** Whether initial context has been sent to the exec session */
  terminalExecContextSent: boolean;
  /** Last exit code for plan mode (persisted in frontmatter) */
  planLastExitCode: number | null;
  /** Last exit code for execute mode (persisted in frontmatter) */
  execLastExitCode: number | null;
  /** Date when task was moved to done status (YYYY-MM-DD) */
  completed: string | null;
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
  decisions: string[];
  /** Only persisted when true; omitted (default false) otherwise */
  useWorktree?: boolean;
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
  /** Tmux session name for planning terminal mode */
  terminalPlanSession?: string | null;
  /** Tmux session name for execution terminal mode */
  terminalExecSession?: string | null;
  /** Whether initial context has been sent to the exec session */
  terminalExecContextSent?: boolean;
  /** Last exit code for plan mode */
  planLastExitCode?: number | null;
  /** Last exit code for execute mode */
  execLastExitCode?: number | null;
  /** Date when task was moved to done status (YYYY-MM-DD) */
  completed?: string | null;
}

/** A single DoD checklist item parsed from the task body */
export interface DodItem {
  text: string;
  checked: boolean;
}

// ── Planning Chat ───────────────────────────────────────────────

/** Token usage data from a step_finish event */
export interface TokenUsage {
  total: number;
  input: number;
  output: number;
  reasoning: number;
  cache: {
    write: number;
    read: number;
  };
}

/** Tool invocation data from a tool_use event */
export interface ToolUseData {
  /** Tool name: bash | read | write | edit | glob | grep | task | webfetch | websearch */
  tool: string;
  /** Input parameters passed to the tool */
  input: Record<string, unknown>;
  /** Tool output, capped at 5KB */
  output: string;
  /** True when the original output exceeded 5KB and was truncated */
  truncated: boolean;
  /** Human-readable title for the tool call */
  title: string;
  /** Process exit code (null for non-shell tools) */
  exitCode: number | null;
  /** Start/end timestamps in Unix ms */
  time: { start: number; end: number } | null;
}

/** A single block in the ordered content array of a PlanMessage */
export interface MessageContentBlock {
  kind: "text" | "thinking" | "tool_use" | "todo_list";
  /** Text content (markdown for text, raw for thinking, tool title for tool_use, todo title for todo_list) */
  content: string;
  /** Present only when kind === "tool_use" */
  data?: ToolUseData;
  /** Present only when kind === "todo_list" */
  todoData?: TodoListData;
}

/** Todo list data from structured output */
export interface TodoListData {
  items: TodoItem[];
}

/** A single todo item */
export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}

/** A chunk of streamed output from the planning agent */
export type PlanChunk =
  | {
      type:
        | "text"
        | "thinking"
        | "session_id"
        | "done"
        | "error"
        | "stderr"
        | "user_message"
        | "replay_done";
      content: string;
    }
  | { type: "tokens"; content: string; data: TokenUsage }
  | { type: "tool_use"; content: string; data: ToolUseData }
  | { type: "todo_list"; content: string; data: TodoListData };

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
  /** Concatenated text content — kept for backward compat with stored messages */
  text: string;
  /** Concatenated thinking content — kept for backward compat */
  thinking?: string;
  /**
   * Ordered content blocks preserving temporal interleaving of text, thinking,
   * and tool_use events.  Present on new messages; absent on messages loaded
   * from older stored logs (use `text` / `thinking` fallback in that case).
   */
  content?: MessageContentBlock[];
  isStreaming: boolean;
  /** Unix timestamp (ms) when the message was created */
  timestamp?: number;
  /**
   * True for synthetic placeholder messages inserted when a replayed log
   * contains no grove_user_message lines (i.e. it predates history tracking).
   */
  isPlaceholder?: boolean;
  /** Model active when this message was created */
  model?: string;
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

// ── Tmux Session Monitoring ──────────────────────────────────────

/** Session type for a Grove tmux session */
export type TmuxSessionType = "plan" | "exec" | "term-plan" | "term-exec";

/** Information about an active Grove tmux session */
export interface TmuxSessionInfo {
  sessionName: string;
  sessionType: TmuxSessionType;
  workspaceHash: string;
  workspacePath: string | null;
  workspaceName: string | null;
  taskId: string;
  taskStatus: TaskStatus | null;
  agent: string | null;
  model: string | null;
  paneCommand: string;
  panePid: number;
  paneDead: boolean;
  sessionCreatedTs: number; // Unix seconds
  paneActivityTs: number; // Unix seconds
  idleSeconds: number; // computed
  durationSeconds: number; // computed
}

// ── Container Runtime ─────────────────────────────────────────────

export type ContainerRuntime = "docker" | "podman";

export interface DevcontainerConfig {
  image?: string;
  build?: {
    dockerfile: string;
    context?: string;
    args?: Record<string, string>;
  };
  containerEnv?: Record<string, string>;
  containerUser?: string;
  forwardPorts?: (number | string)[];
  mount?: string[];
  postCreateCommand?: string;
  updateContentCommand?: string;
  postStartCommand?: string;
  customizations?: Record<string, unknown>;
}

export interface ContainerSession {
  containerId: string;
  containerName: string;
  taskId: string;
  workspacePath: string;
  mode: "ephemeral" | "task-bound";
  startedAt: number;
  image: string;
  sessionId?: string;
  runtime?: ContainerRuntime;
  createdAt?: number;
}

export interface ContainerServiceConfig {
  enabled: boolean;
  runtime: ContainerRuntime;
  defaultImage: string;
  autoCleanup: boolean;
  mountAuthConfig?: boolean;
}

export interface ContainerStartOptions {
  taskId: string;
  workspacePath: string;
  image?: string;
  mountWorktree?: boolean;
  additionalMounts?: string[];
  network?: string;
  ports?: string[];
  env?: Record<string, string>;
  detach?: boolean;
  workdir?: string;
  mountAuthConfig?: boolean;
  devcontainerConfig?: DevcontainerConfig;
  mountWorkspace?: boolean;
  sessionId?: string;
  requireDevcontainer?: boolean;
}

export type ExecutionEnvironmentType = "local" | "container";

export interface ExecutionEnvironment {
  type: ExecutionEnvironmentType;
  runtime?: ContainerRuntime;
  containerName?: string;
  containerId?: string;
  workspacePath?: string;
  workingDirectory: string;
}
