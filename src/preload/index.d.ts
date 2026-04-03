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
  MilestoneInfo,
  MilestoneFrontmatter,
  WorktreeInfo,
  SetupWorktreeInput,
  SetupWorktreeResult,
  TeardownWorktreeInput,
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
  };
  milestones: {
    create: (
      workspacePath: string,
      title: string,
    ) => Promise<IpcResult<MilestoneInfo>>;
    update: (
      workspacePath: string,
      filePath: string,
      changes: Partial<MilestoneFrontmatter>,
      body?: string,
    ) => Promise<IpcResult<void>>;
    readBody: (
      workspacePath: string,
      filePath: string,
    ) => Promise<IpcResult<string>>;
  };
  app: {
    getPlatform: () => Promise<NodeJS.Platform>;
  };
  git: {
    listWorktrees: (repoPath: string) => Promise<IpcResult<WorktreeInfo[]>>;
    setupWorktreeForTask: (
      input: SetupWorktreeInput,
    ) => Promise<IpcResult<SetupWorktreeResult>>;
    teardownWorktreeForTask: (
      input: TeardownWorktreeInput,
    ) => Promise<IpcResult<void>>;
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
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
