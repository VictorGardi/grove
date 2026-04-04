import type {
  WorkspaceInfo,
  WorkspaceEntry,
  WorkspaceData,
  IpcResult,
  FileTreeNode,
  FileReadResult,
  TaskInfo,
  TaskStatus,
  TaskFrontmatter,
  WorktreeInfo,
  SetupWorktreeInput,
  SetupWorktreeResult,
  TeardownWorktreeInput,
  DiffSummary,
  BranchInfo,
  PlanAgent,
  PlanChunk,
  PlanMode,
} from "@shared/types";

export interface ElectronAPI {
  workspaces: {
    list: () => Promise<IpcResult<WorkspaceInfo[]>>;
    add: () => Promise<IpcResult<WorkspaceEntry | null>>;
    addPath: (path: string) => Promise<IpcResult<WorkspaceEntry>>;
    remove: (path: string) => Promise<IpcResult<void>>;
    setActive: (path: string) => Promise<IpcResult<void>>;
    getActive: () => Promise<IpcResult<string | null>>;
    getBranch: (path: string) => Promise<IpcResult<string>>;
    onBranchChanged: (
      callback: (data: { path: string; branch: string }) => void,
    ) => () => void;
  };
  data: {
    fetch: (workspacePath: string) => Promise<IpcResult<WorkspaceData>>;
    onChanged: (callback: () => void) => () => void;
  };
  fs: {
    tree: (workspacePath: string) => Promise<IpcResult<FileTreeNode[]>>;
    readFile: (
      workspacePath: string,
      relativePath: string,
    ) => Promise<IpcResult<FileReadResult>>;
    onTreeChanged: (callback: () => void) => () => void;
    onFileChanged: (callback: (filePath: string) => void) => () => void;
  };
  tasks: {
    create: (
      workspacePath: string,
      title: string,
    ) => Promise<IpcResult<TaskInfo>>;
    update: (
      workspacePath: string,
      filePath: string,
      changes: Partial<TaskFrontmatter>,
      body?: string,
    ) => Promise<IpcResult<TaskInfo>>;
    move: (
      workspacePath: string,
      filePath: string,
      toStatus: TaskStatus,
    ) => Promise<IpcResult<TaskInfo>>;
    archive: (
      workspacePath: string,
      filePath: string,
    ) => Promise<IpcResult<void>>;
    readBody: (
      workspacePath: string,
      filePath: string,
    ) => Promise<IpcResult<string>>;
    readRaw: (
      workspacePath: string,
      filePath: string,
    ) => Promise<IpcResult<string>>;
    writeRaw: (
      workspacePath: string,
      filePath: string,
      rawContent: string,
    ) => Promise<IpcResult<TaskInfo>>;
  };
  app: {
    getPlatform: () => Promise<NodeJS.Platform>;
    setTitleBarColor: (opts: {
      color: string;
      symbolColor: string;
    }) => Promise<void>;
  };
  git: {
    listWorktrees: (repoPath: string) => Promise<IpcResult<WorktreeInfo[]>>;
    setupWorktreeForTask: (
      input: SetupWorktreeInput,
    ) => Promise<IpcResult<SetupWorktreeResult>>;
    teardownWorktreeForTask: (
      input: TeardownWorktreeInput,
    ) => Promise<IpcResult<void>>;
    diff: (
      worktreePath: string,
      baseBranch?: string,
    ) => Promise<IpcResult<DiffSummary>>;
    fileDiff: (
      worktreePath: string,
      filePath: string,
      baseBranch?: string,
    ) => Promise<IpcResult<string>>;
    listBranches: (workspacePath: string) => Promise<IpcResult<BranchInfo[]>>;
    treeForBranch: (
      workspacePath: string,
      branch: string,
    ) => Promise<IpcResult<FileTreeNode[]>>;
    readFileAtBranch: (
      workspacePath: string,
      branch: string,
      relativePath: string,
    ) => Promise<IpcResult<FileReadResult>>;
  };
  pty: {
    create: (id: string, cwd: string) => Promise<IpcResult<void>>;
    write: (id: string, data: string) => void;
    resize: (id: string, cols: number, rows: number) => void;
    kill: (id: string) => Promise<IpcResult<void>>;
    isIdle: (id: string) => Promise<IpcResult<boolean>>;
    onData: (callback: (id: string, data: string) => void) => () => void;
    onExit: (
      callback: (id: string, exitCode: number, signal?: number) => void,
    ) => () => void;
  };
  plan: {
    send: (input: {
      taskId: string;
      mode: PlanMode;
      agent: PlanAgent;
      model: string | null;
      message: string;
      sessionId: string | null;
      workspacePath: string;
      taskFilePath: string;
      worktreePath?: string;
    }) => Promise<IpcResult<void>>;
    cancel: (input: {
      taskId: string;
      mode: PlanMode;
    }) => Promise<IpcResult<void>>;
    listModels: (input: {
      agent: PlanAgent;
      workspacePath: string;
    }) => Promise<IpcResult<string[]>>;
    saveSession: (input: {
      workspacePath: string;
      filePath: string;
      sessionId: string;
      agent: PlanAgent;
      model: string | null;
      mode: PlanMode;
    }) => Promise<IpcResult<void>>;
    onChunk: (
      callback: (taskId: string, mode: PlanMode, chunk: PlanChunk) => void,
    ) => () => void;
  };
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
