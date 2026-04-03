import matter from "gray-matter";
import * as fs from "fs";
import * as path from "path";
import type {
  MilestoneInfo,
  MilestoneStatus,
  MilestoneFrontmatter,
  TaskInfo,
} from "@shared/types";
import { atomicWrite } from "./fileWriter";

/** Session-level counter to prevent TOCTOU race on rapid creates */
let lastGeneratedId = 0;

export async function parseMilestoneFile(
  filePath: string,
): Promise<Omit<MilestoneInfo, "taskCounts"> | null> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const { data, content } = matter(raw);

    const filename = path.basename(filePath, ".md");
    const idMatch = filename.match(/^(M-\d+)/);
    const id =
      typeof data.id === "string" ? data.id : idMatch ? idMatch[1] : filename;
    const title =
      typeof data.title === "string"
        ? data.title
        : filename.replace(/^M-\d+-/, "").replace(/-/g, " ");

    const rawStatus =
      typeof data.status === "string" ? data.status.toLowerCase() : "open";
    const status: MilestoneStatus = rawStatus === "closed" ? "closed" : "open";

    return {
      id,
      title,
      status,
      created:
        typeof data.created === "string"
          ? data.created
          : data.created instanceof Date
            ? data.created.toISOString().split("T")[0]
            : null,
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      description: content.trim(),
      filePath,
    };
  } catch (err) {
    console.warn(`[Milestones] Failed to parse ${filePath}:`, err);
    return null;
  }
}

export async function scanMilestones(
  workspacePath: string,
  tasks: TaskInfo[],
): Promise<MilestoneInfo[]> {
  const milestoneDir = path.join(workspacePath, ".milestones");
  const milestones: MilestoneInfo[] = [];

  try {
    const entries = await fs.promises.readdir(milestoneDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const filePath = path.join(milestoneDir, entry);
      const parsed = await parseMilestoneFile(filePath);
      if (!parsed) continue;

      // Compute taskCounts by cross-referencing the task list
      const linked = tasks.filter((t) => t.milestone === parsed.id);
      milestones.push({
        ...parsed,
        taskCounts: {
          total: linked.length,
          done: linked.filter((t) => t.status === "done").length,
          doing: linked.filter((t) => t.status === "doing").length,
          review: linked.filter((t) => t.status === "review").length,
          backlog: linked.filter((t) => t.status === "backlog").length,
        },
      });
    }
  } catch {
    // Directory may not exist yet
  }

  return milestones;
}

export async function initMilestoneDirs(workspacePath: string): Promise<void> {
  await fs.promises.mkdir(path.join(workspacePath, ".milestones"), {
    recursive: true,
  });
}

// ── Phase 4: Milestone Write Operations ──────────────────────────

/**
 * Generate next milestone ID by scanning .milestones/ directory.
 * Uses session-level counter to prevent duplicates on rapid creates.
 */
export async function nextMilestoneId(workspacePath: string): Promise<string> {
  const milestoneDir = path.join(workspacePath, ".milestones");
  let maxId = 0;

  try {
    const entries = await fs.promises.readdir(milestoneDir);
    for (const entry of entries) {
      const match = entry.match(/^M-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxId) maxId = num;
      }
    }
  } catch {
    // Directory may not exist
  }

  const nextNum = Math.max(maxId, lastGeneratedId) + 1;
  lastGeneratedId = nextNum;
  const padded = String(nextNum).padStart(3, "0");
  return `M-${padded}`;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function buildMilestoneFrontmatter(
  fm: MilestoneFrontmatter,
): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    id: fm.id,
    title: fm.title,
    status: fm.status,
  };
  if (fm.created) obj.created = fm.created;
  if (fm.tags.length > 0) obj.tags = fm.tags;
  return obj;
}

/**
 * Create a new milestone file in .milestones/.
 * Returns a MilestoneInfo with zero task counts.
 */
export async function createMilestone(
  workspacePath: string,
  title: string,
): Promise<MilestoneInfo> {
  const id = await nextMilestoneId(workspacePath);
  const slug = slugify(title);
  const filename = `${id}-${slug || "untitled"}.md`;
  const created = new Date().toISOString().split("T")[0];

  const frontmatter: MilestoneFrontmatter = {
    id,
    title,
    status: "open",
    created,
    tags: [],
  };

  const body = `\n## Description\n\n\n## Key deliverables\n\n- Define deliverables\n`;

  const content = matter.stringify(
    body,
    buildMilestoneFrontmatter(frontmatter),
  );
  const filePath = path.join(workspacePath, ".milestones", filename);
  await initMilestoneDirs(workspacePath);
  await atomicWrite(filePath, content);

  return {
    id,
    title,
    status: "open",
    created,
    tags: [],
    description: body.trim(),
    filePath,
    taskCounts: { total: 0, done: 0, doing: 0, review: 0, backlog: 0 },
  };
}

/**
 * Read-merge-write update for milestone files.
 */
export async function updateMilestone(
  workspacePath: string,
  filePath: string,
  changes: Partial<MilestoneFrontmatter>,
  body?: string,
): Promise<void> {
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

  const finalBody = body !== undefined ? body : parsed.content;
  const content = matter.stringify(finalBody, parsed.data);
  await atomicWrite(filePath, content);
}

/**
 * Read full milestone body (validates path traversal).
 */
export async function readMilestoneBody(
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
