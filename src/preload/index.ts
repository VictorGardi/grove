import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  workspaces: {
    list: () => ipcRenderer.invoke("workspace:list"),
    add: () => ipcRenderer.invoke("workspace:add"),
    addPath: (path: string) => ipcRenderer.invoke("workspace:addPath", path),
    remove: (path: string) => ipcRenderer.invoke("workspace:remove", path),
    setActive: (path: string) =>
      ipcRenderer.invoke("workspace:setActive", path),
    getActive: () => ipcRenderer.invoke("workspace:getActive"),
    getBranch: (path: string) =>
      ipcRenderer.invoke("workspace:getBranch", path),
    getDefaults: (path: string) =>
      ipcRenderer.invoke("workspace:getDefaults", path),
    setDefaults: (
      path: string,
      defaults: {
        defaultPlanningAgent?: string;
        defaultPlanningModel?: string;
        defaultExecutionAgent?: string;
        defaultExecutionModel?: string;
      },
    ) => ipcRenderer.invoke("workspace:setDefaults", path, defaults),
    getHidden: (path: string) =>
      ipcRenderer.invoke("workspace:getHidden", path),
    setHidden: (path: string, hidden: boolean) =>
      ipcRenderer.invoke("workspace:setHidden", path, hidden),
    onBranchChanged: (
      callback: (data: { path: string; branch: string }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { path: string; branch: string },
      ) => callback(data);
      ipcRenderer.on("workspace:branchChanged", handler);
      return () =>
        ipcRenderer.removeListener("workspace:branchChanged", handler);
    },
    fetchTasks: (workspacePath: string) =>
      ipcRenderer.invoke("workspace:tasks", workspacePath),
  },
  data: {
    fetch: (workspacePath: string) =>
      ipcRenderer.invoke("workspace:data", workspacePath),
    onChanged: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on("workspace:dataChanged", handler);
      return () => ipcRenderer.removeListener("workspace:dataChanged", handler);
    },
  },
  fs: {
    tree: (workspacePath: string) =>
      ipcRenderer.invoke("fs:tree", workspacePath),
    readFile: (workspacePath: string, relativePath: string) =>
      ipcRenderer.invoke("fs:readFile", workspacePath, relativePath),
    onTreeChanged: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on("fs:treeChanged", handler);
      return () => ipcRenderer.removeListener("fs:treeChanged", handler);
    },
    onFileChanged: (callback: (filePath: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, filePath: string) =>
        callback(filePath);
      ipcRenderer.on("fs:fileChanged", handler);
      return () => ipcRenderer.removeListener("fs:fileChanged", handler);
    },
  },
  tasks: {
    create: (workspacePath: string, title: string) =>
      ipcRenderer.invoke("task:create", workspacePath, title),
    update: (
      workspacePath: string,
      filePath: string,
      changes: Record<string, unknown>,
      body?: string,
    ) =>
      ipcRenderer.invoke("task:update", workspacePath, filePath, changes, body),
    move: (workspacePath: string, filePath: string, toStatus: string) =>
      ipcRenderer.invoke("task:move", workspacePath, filePath, toStatus),
    archive: (workspacePath: string, filePath: string) =>
      ipcRenderer.invoke("task:archive", workspacePath, filePath),
    readBody: (workspacePath: string, filePath: string) =>
      ipcRenderer.invoke("task:readBody", workspacePath, filePath),
    readRaw: (workspacePath: string, filePath: string) =>
      ipcRenderer.invoke("task:readRaw", workspacePath, filePath),
    writeRaw: (workspacePath: string, filePath: string, rawContent: string) =>
      ipcRenderer.invoke("task:writeRaw", workspacePath, filePath, rawContent),
  },
  git: {
    listWorktrees: (repoPath: string) =>
      ipcRenderer.invoke("git:listWorktrees", repoPath),
    setupWorktreeForTask: (input: {
      workspacePath: string;
      taskFilePath: string;
      taskId: string;
      taskTitle: string;
    }) => ipcRenderer.invoke("git:setupWorktreeForTask", input),
    teardownWorktreeForTask: (input: {
      workspacePath: string;
      taskFilePath: string;
      worktreePath: string;
    }) => ipcRenderer.invoke("git:teardownWorktreeForTask", input),
    diff: (worktreePath: string, baseBranch?: string) =>
      ipcRenderer.invoke("git:diff", worktreePath, baseBranch),
    fileDiff: (worktreePath: string, filePath: string, baseBranch?: string) =>
      ipcRenderer.invoke("git:fileDiff", worktreePath, filePath, baseBranch),
    listBranches: (workspacePath: string) =>
      ipcRenderer.invoke("git:listBranches", workspacePath),
    treeForBranch: (workspacePath: string, branch: string) =>
      ipcRenderer.invoke("git:treeForBranch", workspacePath, branch),
    readFileAtBranch: (
      workspacePath: string,
      branch: string,
      relativePath: string,
    ) =>
      ipcRenderer.invoke(
        "git:readFileAtBranch",
        workspacePath,
        branch,
        relativePath,
      ),
  },
  pty: {
    create: (id: string, cwd: string) =>
      ipcRenderer.invoke("pty:create", id, cwd),
    write: (id: string, data: string) =>
      ipcRenderer.send("pty:write", id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send("pty:resize", id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke("pty:kill", id),
    isIdle: (id: string) => ipcRenderer.invoke("pty:isIdle", id),
    getOutput: (id: string) => ipcRenderer.invoke("pty:getOutput", id),
    clearOutput: (id: string) => ipcRenderer.invoke("pty:clearOutput", id),
    onData: (callback: (id: string, data: string) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        id: string,
        data: string,
      ) => callback(id, data);
      ipcRenderer.on("pty:data", handler);
      return () => ipcRenderer.removeListener("pty:data", handler);
    },
    onExit: (
      callback: (id: string, exitCode: number, signal?: number) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        id: string,
        info: { exitCode: number; signal?: number },
      ) => callback(id, info.exitCode, info.signal);
      ipcRenderer.on("pty:exit", handler);
      return () => ipcRenderer.removeListener("pty:exit", handler);
    },
  },
  taskterm: {
    create: (params: {
      ptyId: string;
      taskId: string;
      taskFilePath: string;
      workspacePath: string;
      agent: string;
      model: string | null;
      cwd: string;
      cols?: number;
      rows?: number;
    }) => ipcRenderer.invoke("taskterm:create", params),
    reconnect: (params: {
      ptyId: string;
      sessionName: string;
      cwd: string;
      cols?: number;
      rows?: number;
    }) => ipcRenderer.invoke("taskterm:reconnect", params),
    capture: (sessionName: string) =>
      ipcRenderer.invoke("taskterm:capture", sessionName),
    isAlive: (sessionName: string) =>
      ipcRenderer.invoke("taskterm:isalive", sessionName),
    kill: (params: { ptyId: string; sessionName: string }) =>
      ipcRenderer.invoke("taskterm:kill", params),
    paneCommand: (sessionName: string) =>
      ipcRenderer.invoke("taskterm:panecommand", sessionName),
    state: (sessionName: string, agent: string) =>
      ipcRenderer.invoke("taskterm:state", sessionName, agent),
    refresh: (sessionName: string) =>
      ipcRenderer.invoke("taskterm:refresh", sessionName),
    writeContext: (params: { sessionName: string; content: string; workspacePath: string }) =>
      ipcRenderer.invoke("taskterm:writecontext", params),
    cleanContext: (sessionName: string) =>
      ipcRenderer.invoke("taskterm:cleancontext", sessionName),
  },
  app: {
    getPlatform: () => ipcRenderer.invoke("app:getPlatform"),
    getTheme: () => ipcRenderer.invoke("app:getTheme"),
    setTheme: (theme: string) => ipcRenderer.invoke("app:setTheme", theme),
    setTitleBarColor: (opts: { color: string; symbolColor: string }) =>
      ipcRenderer.invoke("app:setTitleBarColor", opts),
    getWindowOpacity: () => ipcRenderer.invoke("app:getWindowOpacity"),
    setWindowOpacity: (opacity: number) =>
      ipcRenderer.invoke("app:setWindowOpacity", opacity),
  },
  tmux: {
    listGroveSessions: () => ipcRenderer.invoke("tmux:listGroveSessions"),
    killSession: (params: { sessionName: string }) =>
      ipcRenderer.invoke("tmux:killSession", params),
  },
  plan: {
    listModels: (input: { agent: string; workspacePath: string }) =>
      ipcRenderer.invoke("plan:listModels", input),

    saveSession: (input: {
      workspacePath: string;
      filePath: string;
      sessionId: string;
      agent: string;
      model: string | null;
      mode: string;
    }) => ipcRenderer.invoke("plan:saveSession", input),

    captureTmuxPane: (input: { session: string }) =>
      ipcRenderer.invoke("plan:tmux-capture-pane", input),
  },
});
