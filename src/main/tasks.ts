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
import { TASKS_DIR, STATUS_DIRS, ALL_TASK_DIRS } from "./paths";

/**
 * Per-file write lock: chains write operations so they execute serially.
 * Prevents concurrent read-modify-write races when rapid IPC calls arrive
 * for the same file (e.g. status change + description debounce firing together).
 */
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

/** Per-workspace session-level counters to prevent TOCTOU race on rapid creates */
const lastGeneratedIds = new Map<string, number>();

export async function parseTaskFile(
  filePath: string,
  status: TaskStatus,
  workspacePath: string,
): Promise<TaskInfo | null> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const { data, content } = matter(raw);

    // ID: frontmatter > filename-derived
    const filename = path.basename(filePath, ".md");
    const idMatch = filename.match(/^(T-\d+)/);
    const id =
      typeof data.id === "string" ? data.id : idMatch ? idMatch[1] : filename;

    // Title: frontmatter > filename slug (skip generic "New task")
    const rawTitle = data.title;
    const title =
      typeof rawTitle === "string" && rawTitle.toLowerCase() !== "new task"
        ? rawTitle
        : filename.replace(/^T-\d+-/, "").replace(/-/g, " ");

    // DoD checkboxes
    const dodDone = (content.match(/^- \[x\]/gm) || []).length;
    const dodTotal = dodDone + (content.match(/^- \[ \]/gm) || []).length;

    // Description: scan lines, skip headings and blank lines, take first
    // contiguous block of content lines, join and truncate to 200 chars
    const lines = content.split("\n");
    const descLines: string[] = [];
    let foundContent = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || trimmed === "") {
        if (foundContent) break; // end of first paragraph
        continue;
      }
      if (trimmed.startsWith("- [")) continue; // skip DoD lines
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
      decisions: Array.isArray(data.decisions)
        ? data.decisions.map(String)
        : [],
      description,
      dodTotal,
      dodDone,
      filePath,
      workspacePath,
      // useWorktree defaults to false; only true when explicitly set to true
      useWorktree: data.useWorktree === true,
      planSessionId:
        typeof data.planSessionId === "string" ? data.planSessionId : null,
      planSessionAgent:
        data.planSessionAgent === "opencode" ||
        data.planSessionAgent === "copilot" ||
        data.planSessionAgent === "claude"
          ? (data.planSessionAgent as PlanAgent)
          : null,
      planModel: typeof data.planModel === "string" ? data.planModel : null,
      execSessionId:
        typeof data.execSessionId === "string" ? data.execSessionId : null,
      execSessionAgent:
        data.execSessionAgent === "opencode" ||
        data.execSessionAgent === "copilot" ||
        data.execSessionAgent === "claude"
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
  const taskBase = path.join(workspacePath, TASKS_DIR);

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
      // Directory may not exist yet — that's fine
    }
  }

  return tasks;
}

export async function initTaskDirs(workspacePath: string): Promise<void> {
  const taskBase = path.join(workspacePath, TASKS_DIR);
  for (const dir of ALL_TASK_DIRS) {
    await fs.promises.mkdir(path.join(taskBase, dir), { recursive: true });
  }
}

// ── Phase 4: Task Write Operations ──────────────────────────────

/**
 * Generate next task ID by scanning all task directories including archive.
 * Uses a session-level counter to prevent duplicate IDs on rapid successive creates.
 */
export async function nextTaskId(workspacePath: string): Promise<string> {
  const taskBase = path.join(workspacePath, TASKS_DIR);
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

/**
 * Build frontmatter object from TaskFrontmatter, omitting null/empty fields.
 */
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
  if (fm.decisions.length > 0) obj.decisions = fm.decisions;
  // Only persist useWorktree when explicitly true (default is false)
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

/**
 * Create a new task file in .grove/tasks/backlog/ with a generated ID.
 * Returns the parsed TaskInfo for the created task.
 */
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
    decisions: [],
    useWorktree: false,
  };

  const body = `\n## Description\n\n\n## Definition of Done\n\n- [ ] Define acceptance criteria\n\n## Context for agent\n\n`;

  const content = matter.stringify(body, buildFrontmatter(frontmatter));
  const filePath = path.join(workspacePath, TASKS_DIR, "backlog", filename);
  await initTaskDirs(workspacePath);
  await atomicWrite(filePath, content);

  // Parse the file we just wrote to get a proper TaskInfo
  const task = await parseTaskFile(filePath, "backlog", workspacePath);
  if (!task)
    throw new Error(`Failed to parse newly created task at ${filePath}`);
  return task;
}

/**
 * Read-merge-write update: reads current file, merges only the changed fields, writes back.
 * Prevents overwriting concurrent agent edits with stale renderer state.
 * Uses a per-file write lock to serialise concurrent IPC calls (e.g. status
 * change + description debounce arriving at the same time).
 */
export function updateTask(
  workspacePath: string,
  filePath: string,
  changes: Partial<TaskFrontmatter>,
  body?: string,
): Promise<TaskInfo> {
  return withWriteLock(filePath, async () => {
    // Path traversal protection
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(workspacePath))) {
      throw new Error("Path traversal detected");
    }

    const raw = await fs.promises.readFile(filePath, "utf-8");
    const parsed = matter(raw);

    // Merge frontmatter changes
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === undefined) {
        delete parsed.data[key];
      } else {
        parsed.data[key] = value;
      }
    }

    // Keep frontmatter status in sync with the actual directory so the two
    // never drift apart (directory is the canonical source of truth).
    const dirName = path.basename(path.dirname(filePath));
    if (STATUS_DIRS.includes(dirName as TaskStatus)) {
      parsed.data.status = dirName;
    }

    // Use provided body or keep the existing one
    const finalBody = body !== undefined ? body : parsed.content;
    const content = matter.stringify(finalBody, parsed.data);
    await atomicWrite(filePath, content);

    // Derive status from the directory — not from frontmatter — because the
    // directory is always the canonical location for a task's column.
    const status = STATUS_DIRS.includes(dirName as TaskStatus)
      ? (dirName as TaskStatus)
      : "backlog";
    const task = await parseTaskFile(filePath, status, workspacePath);
    if (!task)
      throw new Error(`Failed to re-parse task after update: ${filePath}`);
    return task;
  });
}

/**
 * Move task file between status directories.
 * Reads file, updates status in frontmatter, writes to new dir, deletes old file.
 * If delete fails after write, logs warning (duplicate but no data loss).
 */
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

    // Update status in frontmatter
    parsed.data.status = toStatus;

    // Set completed date when moving to done
    if (toStatus === "done") {
      parsed.data.completed = new Date().toISOString();
    }

    const content = matter.stringify(parsed.content, parsed.data);
    const filename = path.basename(filePath);
    const newPath = path.join(workspacePath, TASKS_DIR, toStatus, filename);

    // Ensure target directory exists
    await fs.promises.mkdir(path.dirname(newPath), { recursive: true });

    // Write to new location first (safe — no data loss if delete fails)
    await atomicWrite(newPath, content);

    // Delete from old location
    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      console.warn(
        `[Tasks] Failed to delete old task file after move: ${filePath}`,
        err,
      );
    }

    // Return confirmed post-move state
    const task = await parseTaskFile(newPath, toStatus, workspacePath);
    if (!task)
      throw new Error(`Failed to re-parse task after move: ${newPath}`);
    return task;
  });
}

/**
 * Archive a task — moves to .grove/tasks/archive/, never hard-delete.
 */
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
  const archivePath = path.join(workspacePath, TASKS_DIR, "archive", filename);

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

/**
 * Read full task body (not truncated, unlike scanTasks which truncates description).
 * Validates path traversal before reading.
 */
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

/**
 * Read the full raw markdown file (frontmatter + body) for the task editor overlay.
 * Validates path traversal before reading.
 */
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

/**
 * Write the full raw markdown file (frontmatter + body) from the task editor overlay.
 * Uses the write lock to prevent races. Validates path traversal.
 */
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

    // Derive status from directory
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
