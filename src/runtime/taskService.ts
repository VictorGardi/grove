import matter from "gray-matter";
import * as fs from "fs";
import * as path from "path";
import type {
  TaskInfo,
  TaskStatus,
  TaskFrontmatter,
  PlanAgent,
} from "@shared/types";
import { atomicWrite } from "./fileWriter";

const STATUS_DIRS: TaskStatus[] = ["backlog", "doing", "review", "done"];
const ALL_TASK_DIRS = ["backlog", "doing", "review", "done", "archive"];

const writeLocks = new Map<string, Promise<void>>();
function withWriteLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(filePath) ?? Promise.resolve();
  let resolve!: () => void;
  const gate = new Promise<void>((r) => {
    resolve = r;
  });
  writeLocks.set(filePath, gate);
  return prev.then(fn).finally(resolve) as Promise<T>;
}

const lastGeneratedIds = new Map<string, number>();

export async function parseTaskFile(
  filePath: string,
  status: TaskStatus,
  workspacePath: string,
): Promise<TaskInfo | null> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const { data, content } = matter(raw);

    const filename = path.basename(filePath, ".md");
    const idMatch = filename.match(/^(T-\d+)/);
    const id =
      typeof data.id === "string" ? data.id : idMatch ? idMatch[1] : filename;

    const rawTitle = data.title;
    const title =
      typeof rawTitle === "string" && rawTitle.toLowerCase() !== "new task"
        ? rawTitle
        : filename.replace(/^T-\d+-/, "").replace(/-/g, " ");

    const dodDone = (content.match(/^- \[x\]/gm) || []).length;
    const dodTotal = dodDone + (content.match(/^- \[ \]/gm) || []).length;

    const lines = content.split("\n");
    const descLines: string[] = [];
    let foundContent = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || trimmed === "") {
        if (foundContent) break;
        continue;
      }
      if (trimmed.startsWith("- [")) continue;
      foundContent = true;
      descLines.push(trimmed);
    }
    let description = descLines.join(" ").trim();
    if (description.length > 200)
      description = description.slice(0, 197) + "...";

    return {
      id,
      title,
      status,
      agent: typeof data.agent === "string" ? data.agent : null,
      worktree: typeof data.worktree === "string" ? data.worktree : null,
      branch: typeof data.branch === "string" ? data.branch : null,
      created:
        typeof data.created === "string"
          ? data.created
          : data.created instanceof Date
            ? data.created.toISOString()
            : null,
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      decisions: Array.isArray(data.decisions)
        ? data.decisions.map(String)
        : [],
      description,
      dodTotal,
      dodDone,
      filePath,
      workspacePath,
      useWorktree: data.useWorktree === true,
      planSessionId:
        typeof data.planSessionId === "string" ? data.planSessionId : null,
      planSessionAgent:
        data.planSessionAgent === "opencode" ||
        data.planSessionAgent === "copilot"
          ? (data.planSessionAgent as PlanAgent)
          : null,
      planModel: typeof data.planModel === "string" ? data.planModel : null,
      execSessionId:
        typeof data.execSessionId === "string" ? data.execSessionId : null,
      execSessionAgent:
        data.execSessionAgent === "opencode" ||
        data.execSessionAgent === "copilot"
          ? (data.execSessionAgent as PlanAgent)
          : null,
      execModel: typeof data.execModel === "string" ? data.execModel : null,
      terminalPlanSession:
        typeof data.terminalPlanSession === "string"
          ? data.terminalPlanSession
          : null,
      terminalExecSession:
        typeof data.terminalExecSession === "string"
          ? data.terminalExecSession
          : null,
      terminalExecContextSent:
        typeof data.terminalExecContextSent === "boolean"
          ? data.terminalExecContextSent
          : false,
      planLastExitCode:
        typeof data.planLastExitCode === "number"
          ? data.planLastExitCode
          : null,
      execLastExitCode:
        typeof data.execLastExitCode === "number"
          ? data.execLastExitCode
          : null,
      completed: typeof data.completed === "string" ? data.completed : null,
    };
  } catch (err) {
    console.warn(`[Tasks] Failed to parse ${filePath}:`, err);
    return null;
  }
}

export async function scanTasks(workspacePath: string): Promise<TaskInfo[]> {
  const tasks: TaskInfo[] = [];
  const taskBase = path.join(workspacePath, ".tasks");

  for (const status of STATUS_DIRS) {
    const dirPath = path.join(taskBase, status);
    try {
      const entries = await fs.promises.readdir(dirPath);
      for (const entry of entries) {
        if (!entry.endsWith(".md")) continue;
        const fp = path.join(dirPath, entry);
        const task = await parseTaskFile(fp, status, workspacePath);
        if (task) tasks.push(task);
      }
    } catch {
      // Directory may not exist yet
    }
  }

  return tasks;
}

export async function initTaskDirs(workspacePath: string): Promise<void> {
  const taskBase = path.join(workspacePath, ".tasks");
  for (const dir of ALL_TASK_DIRS) {
    await fs.promises.mkdir(path.join(taskBase, dir), { recursive: true });
  }
}

export async function nextTaskId(workspacePath: string): Promise<string> {
  const taskBase = path.join(workspacePath, ".tasks");
  let maxId = 0;

  for (const dir of ALL_TASK_DIRS) {
    const dirPath = path.join(taskBase, dir);
    try {
      const entries = await fs.promises.readdir(dirPath);
      for (const entry of entries) {
        const match = entry.match(/^T-(\d+)/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxId) maxId = num;
        }
      }
    } catch {
      // Directory may not exist
    }
  }

  const wsKey = path.resolve(workspacePath);
  const sessionMax = lastGeneratedIds.get(wsKey) ?? 0;
  const nextNum = Math.max(maxId, sessionMax) + 1;
  lastGeneratedIds.set(wsKey, nextNum);
  const padded = String(nextNum).padStart(3, "0");
  return `T-${padded}`;
}

function buildFrontmatter(fm: TaskFrontmatter): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    id: fm.id,
    title: fm.title,
    status: fm.status,
  };
  if (fm.agent) obj.agent = fm.agent;
  if (fm.worktree) obj.worktree = fm.worktree;
  if (fm.branch) obj.branch = fm.branch;
  if (fm.created) obj.created = fm.created;
  if (fm.tags.length > 0) obj.tags = fm.tags;
  if (fm.decisions.length > 0) obj.decisions = fm.decisions;
  if (fm.useWorktree === true) obj.useWorktree = true;
  if (fm.planSessionId != null) obj.planSessionId = fm.planSessionId;
  if (fm.planSessionAgent != null) obj.planSessionAgent = fm.planSessionAgent;
  if (fm.planModel != null) obj.planModel = fm.planModel;
  if (fm.execSessionId != null) obj.execSessionId = fm.execSessionId;
  if (fm.execSessionAgent != null) obj.execSessionAgent = fm.execSessionAgent;
  if (fm.execModel != null) obj.execModel = fm.execModel;
  if (fm.terminalPlanSession != null)
    obj.terminalPlanSession = fm.terminalPlanSession;
  if (fm.terminalExecSession != null)
    obj.terminalExecSession = fm.terminalExecSession;
  if (fm.terminalExecContextSent != null)
    obj.terminalExecContextSent = fm.terminalExecContextSent;
  if (fm.planLastExitCode != null) obj.planLastExitCode = fm.planLastExitCode;
  if (fm.execLastExitCode != null) obj.execLastExitCode = fm.execLastExitCode;
  if (fm.completed != null) obj.completed = fm.completed;
  return obj;
}

export async function createTask(
  workspacePath: string,
  title: string,
): Promise<TaskInfo> {
  const id = await nextTaskId(workspacePath);
  const filename = `${id}.md`;
  const created = new Date().toISOString();

  const frontmatter: TaskFrontmatter = {
    id,
    title,
    status: "backlog",
    agent: null,
    worktree: null,
    branch: null,
    created,
    tags: [],
    decisions: [],
    useWorktree: false,
  };

  const body = `\n## Description\n\n\n## Definition of Done\n\n- [ ] Define acceptance criteria\n\n## Context for agent\n\n`;

  const content = matter.stringify(body, buildFrontmatter(frontmatter));
  const filePath = path.join(workspacePath, ".tasks", "backlog", filename);
  await initTaskDirs(workspacePath);
  await atomicWrite(filePath, content);

  const task = await parseTaskFile(filePath, "backlog", workspacePath);
  if (!task)
    throw new Error(`Failed to parse newly created task at ${filePath}`);
  return task;
}

export function updateTask(
  workspacePath: string,
  filePath: string,
  changes: Partial<TaskFrontmatter>,
  body?: string,
): Promise<TaskInfo> {
  return withWriteLock(filePath, async () => {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(workspacePath))) {
      throw new Error("Path traversal detected");
    }

    const raw = await fs.promises.readFile(filePath, "utf-8");
    const parsed = matter(raw);

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === undefined) {
        delete parsed.data[key];
      } else {
        parsed.data[key] = value;
      }
    }

    const dirName = path.basename(path.dirname(filePath));
    if (STATUS_DIRS.includes(dirName as TaskStatus)) {
      parsed.data.status = dirName;
    }

    const finalBody = body !== undefined ? body : parsed.content;
    const content = matter.stringify(finalBody, parsed.data);
    await atomicWrite(filePath, content);

    const status = STATUS_DIRS.includes(dirName as TaskStatus)
      ? (dirName as TaskStatus)
      : "backlog";
    const task = await parseTaskFile(filePath, status, workspacePath);
    if (!task)
      throw new Error(`Failed to re-parse task after update: ${filePath}`);
    return task;
  });
}

export function moveTask(
  workspacePath: string,
  filePath: string,
  toStatus: TaskStatus,
): Promise<TaskInfo> {
  return withWriteLock(filePath, async () => {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(workspacePath))) {
      throw new Error("Path traversal detected");
    }

    const raw = await fs.promises.readFile(filePath, "utf-8");
    const parsed = matter(raw);

    parsed.data.status = toStatus;

    if (toStatus === "done") {
      parsed.data.completed = new Date().toISOString();
    }

    const content = matter.stringify(parsed.content, parsed.data);
    const filename = path.basename(filePath);
    const newPath = path.join(workspacePath, ".tasks", toStatus, filename);

    await fs.promises.mkdir(path.dirname(newPath), { recursive: true });

    await atomicWrite(newPath, content);

    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      console.warn(
        `[Tasks] Failed to delete old task file after move: ${filePath}`,
        err,
      );
    }

    const task = await parseTaskFile(newPath, toStatus, workspacePath);
    if (!task)
      throw new Error(`Failed to re-parse task after move: ${newPath}`);
    return task;
  });
}

export async function archiveTask(
  workspacePath: string,
  filePath: string,
): Promise<void> {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(workspacePath))) {
    throw new Error("Path traversal detected");
  }

  const raw = await fs.promises.readFile(filePath, "utf-8");
  const parsed = matter(raw);

  parsed.data.status = "archived";

  const content = matter.stringify(parsed.content, parsed.data);
  const filename = path.basename(filePath);
  const archivePath = path.join(workspacePath, ".tasks", "archive", filename);

  await fs.promises.mkdir(path.dirname(archivePath), { recursive: true });
  await atomicWrite(archivePath, content);

  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    console.warn(
      `[Tasks] Failed to delete task file after archive: ${filePath}`,
      err,
    );
  }
}

export async function readTaskBody(
  workspacePath: string,
  filePath: string,
): Promise<string> {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(workspacePath))) {
    throw new Error("Path traversal detected");
  }

  const raw = await fs.promises.readFile(filePath, "utf-8");
  const { content } = matter(raw);
  return content;
}

export async function readTaskRaw(
  workspacePath: string,
  filePath: string,
): Promise<string> {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(workspacePath))) {
    throw new Error("Path traversal detected");
  }

  return fs.promises.readFile(filePath, "utf-8");
}

export function writeTaskRaw(
  workspacePath: string,
  filePath: string,
  rawContent: string,
): Promise<TaskInfo> {
  return withWriteLock(filePath, async () => {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(workspacePath))) {
      throw new Error("Path traversal detected");
    }

    await atomicWrite(filePath, rawContent);

    const dirName = path.basename(path.dirname(filePath));
    const status = STATUS_DIRS.includes(dirName as TaskStatus)
      ? (dirName as TaskStatus)
      : "backlog";

    const task = await parseTaskFile(filePath, status, workspacePath);
    if (!task)
      throw new Error(`Failed to re-parse task after raw write: ${filePath}`);
    return task;
  });
}

export async function resolveTaskPath(
  workspacePath: string,
  taskId: string,
): Promise<string | null> {
  const taskBase = path.join(workspacePath, ".tasks");
  const filename = `${taskId}.md`;

  for (const dir of STATUS_DIRS) {
    const candidate = path.join(taskBase, dir, filename);
    try {
      await fs.promises.access(candidate);
      return candidate;
    } catch {
      // not here
    }
  }

  // Also check archive
  const archiveCandidate = path.join(taskBase, "archive", filename);
  try {
    await fs.promises.access(archiveCandidate);
    return archiveCandidate;
  } catch {
    return null;
  }
}
