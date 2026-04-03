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
  },
  milestones: {
    create: (workspacePath: string, title: string) =>
      ipcRenderer.invoke("milestone:create", workspacePath, title),
    update: (
      workspacePath: string,
      filePath: string,
      changes: Record<string, unknown>,
      body?: string,
    ) =>
      ipcRenderer.invoke(
        "milestone:update",
        workspacePath,
        filePath,
        changes,
        body,
      ),
    readBody: (workspacePath: string, filePath: string) =>
      ipcRenderer.invoke("milestone:readBody", workspacePath, filePath),
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
  app: {
    getPlatform: () => ipcRenderer.invoke("app:getPlatform"),
  },
});
