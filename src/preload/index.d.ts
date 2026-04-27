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
  TmuxSessionInfo,
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
    getDefaults: (path: string) => Promise<
      IpcResult<{
        defaultPlanningAgent?: string;
        defaultPlanningModel?: string;
        defaultExecutionAgent?: string;
        defaultExecutionModel?: string;
      }>
    >;
    setDefaults: (
      path: string,
      defaults: {
        defaultPlanningAgent?: string;
        defaultPlanningModel?: string;
        defaultExecutionAgent?: string;
        defaultExecutionModel?: string;
      },
    ) => Promise<IpcResult<void>>;
    getHidden: (path: string) => Promise<IpcResult<boolean>>;
    setHidden: (path: string, hidden: boolean) => Promise<IpcResult<void>>;
    onBranchChanged: (
      callback: (data: { path: string; branch: string }) => void,
    ) => () => void;
    fetchTasks: (workspacePath: string) => Promise<IpcResult<TaskInfo[]>>;
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
    getTheme: () => Promise<IpcResult<string>>;
    setTheme: (theme: string) => Promise<IpcResult<string>>;
    setTitleBarColor: (opts: {
      color: string;
      symbolColor: string;
    }) => Promise<void>;
    getWindowOpacity: () => Promise<IpcResult<number>>;
    setWindowOpacity: (opacity: number) => Promise<IpcResult<number>>;
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
    getOutput: (id: string) => Promise<IpcResult<string>>;
    clearOutput: (id: string) => Promise<IpcResult<void>>;
    onData: (callback: (id: string, data: string) => void) => () => void;
    onExit: (
      callback: (id: string, exitCode: number, signal?: number) => void,
    ) => () => void;
  };
  taskterm: {
    create: (params: {
      ptyId: string;
      taskId: string;
      taskFilePath: string;
      workspacePath: string;
      agent: string;
      model: string | null;
      cwd: string;
      sessionMode: "plan" | "exec";
      cols?: number;
      rows?: number;
    }) => Promise<{ ok: boolean; sessionName?: string; error?: string }>;
    reconnect: (params: {
      ptyId: string;
      sessionName: string;
      cwd: string;
      cols?: number;
      rows?: number;
    }) => Promise<{ ok: boolean; error?: string }>;
    capture: (sessionName: string) => Promise<{ ok: boolean; content: string }>;
    isAlive: (sessionName: string) => Promise<boolean>;
    kill: (params: {
      ptyId: string;
      sessionName: string;
    }) => Promise<{ ok: true }>;
    paneCommand: (sessionName: string) => Promise<string>;
    state: (
      sessionName: string,
      agent: string,
    ) => Promise<"active" | "interrupted" | "waiting" | "idle">;
    refresh: (sessionName: string) => Promise<void>;
  };
  plan: {
    listModels: (input: {
      agent: string;
      workspacePath: string;
    }) => Promise<IpcResult<string[]>>;
    saveSession: (input: {
      workspacePath: string;
      filePath: string;
      sessionId: string;
      agent: string;
      model: string | null;
      mode: string;
    }) => Promise<IpcResult<void>>;
  };
  opencodeServer: {
    ensure: () => Promise<{ url: string } | { error: string }>;
    kill: () => Promise<void>;
    status: () => Promise<{
      running: boolean;
      url: string | null;
      pid: number | null;
    }>;
  };
  opencodeSession: {
    create: (params: {
      taskId: string;
      workspacePath: string;
      worktreePath: string;
    }) => Promise<IpcResult<{ sessionId: string }>>;
    prompt: (params: {
      taskId: string;
      promptText: string;
    }) => Promise<IpcResult<void>>;
    stop: (params: { taskId: string }) => Promise<IpcResult<void>>;
    get: (params: { taskId: string }) => Promise<
      IpcResult<{ sessionId: string; status: string }> | null
    >;
    messages: (params: { taskId: string }) => Promise<
      IpcResult<Array<{ info: unknown; parts: unknown[] }>>
    >;
  };
  opencodeEvents: {
    subscribe: (params: { taskId: string }) => Promise<IpcResult<void>>;
    unsubscribe: (params: { taskId: string }) => Promise<IpcResult<void>>;
    onEvent: (taskId: string, callback: (events: unknown[]) => void) => () => void;
  };
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
