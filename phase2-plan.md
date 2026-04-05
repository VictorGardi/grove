# Phase 2 — Implementation Plan

## Goal

Read `.tasks/` and `.milestones/` from the active workspace. Render a live kanban board with milestone awareness, and a milestone list view with progress tracking.

---

## Prerequisites

Install dependencies before starting:

```bash
npm install gray-matter chokidar@^3
npm install -D @types/gray-matter
```

- `gray-matter` — YAML frontmatter parsing for Markdown files.
- `chokidar@^3` — cross-platform filesystem watcher. Pin to v3 because it includes the native `fsevents` optional dependency on macOS, which provides lower-latency, more reliable file watching than the pure-JS `fs.watch` fallback in chokidar v4. The existing `postinstall` script (`electron-builder install-app-deps`) handles native compilation.

---

## Step 1 — Shared types

**File:** `src/shared/types.ts`

Add the following types alongside existing `WorkspaceEntry`, `WorkspaceInfo`, etc:

```ts
/** Status columns — maps to directory names in .tasks/ */
export type TaskStatus = "backlog" | "doing" | "review" | "done";

/** Priority levels for task cards — optional frontmatter field */
export type TaskPriority = "critical" | "high" | "medium" | "low";

/** Parsed from a .tasks/{status}/T-XXX-slug.md file */
export interface TaskInfo {
  id: string; // e.g. "T-004" — from frontmatter `id`, or derived from filename
  title: string; // from frontmatter `title`, or derived from filename
  status: TaskStatus;
  priority: TaskPriority | null; // null = no badge rendered
  agent: string | null; // e.g. "claude-code"
  worktree: string | null;
  branch: string | null;
  created: string | null; // ISO date string
  tags: string[];
  decisions: string[]; // e.g. ["D-002"]
  milestone: string | null; // e.g. "M-001"
  description: string; // first ~200 chars of body (for card preview)
  dodTotal: number; // total DoD checklist items
  dodDone: number; // checked items
  filePath: string; // absolute path to the .md file
}

/** Milestone status — binary */
export type MilestoneStatus = "open" | "closed";

/** Parsed from a .milestones/M-XXX-slug.md file */
export interface MilestoneInfo {
  id: string; // e.g. "M-001"
  title: string;
  status: MilestoneStatus;
  created: string | null; // ISO date string
  tags: string[];
  description: string; // full body content
  filePath: string; // absolute path to the .md file
  // Computed at query time, not stored in file:
  taskCounts: {
    total: number;
    done: number;
    doing: number;
    review: number;
    backlog: number;
  };
}

/** Combined workspace data — returned atomically to avoid stale cross-references */
export interface WorkspaceData {
  tasks: TaskInfo[];
  milestones: MilestoneInfo[];
}
```

**Key design decisions:**

- `taskCounts` on `MilestoneInfo`: Progress is computed by cross-referencing tasks. The main process resolves this so the renderer never has to cross-reference stores.
- `WorkspaceData`: A single atomic response containing both tasks and milestones, ensuring milestone `taskCounts` are always consistent with the task list the board displays.
- `priority` is nullable: When `null`, the priority badge is simply not rendered on the card. This is the common case for existing `.tasks/` files that don't have a `priority` frontmatter field.
- `id` fallback: If frontmatter has no `id`, derive from filename (e.g. `T-004-slug.md` → `T-004`). If frontmatter has no `title`, use the filename slug.

---

## Step 2 — Task file parser (main process)

**File:** `src/main/tasks.ts`

Create a module responsible for:

1. Scanning `.tasks/{backlog,doing,review,done}/*.md`
2. Parsing each file with `gray-matter`
3. Extracting DoD progress from the Markdown body
4. Extracting a description preview
5. Returning `TaskInfo[]`

```ts
import matter from "gray-matter";
import * as fs from "fs";
import * as path from "path";
import type { TaskInfo, TaskStatus, TaskPriority } from "@shared/types";

const STATUS_DIRS: TaskStatus[] = ["backlog", "doing", "review", "done"];
const VALID_PRIORITIES: TaskPriority[] = ["critical", "high", "medium", "low"];

export async function parseTaskFile(
  filePath: string,
  status: TaskStatus,
): Promise<TaskInfo | null> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const { data, content } = matter(raw);

    // ID: frontmatter > filename-derived
    const filename = path.basename(filePath, ".md");
    const idMatch = filename.match(/^(T-\d+)/);
    const id =
      typeof data.id === "string" ? data.id : idMatch ? idMatch[1] : filename;

    // Title: frontmatter > filename slug
    const title =
      typeof data.title === "string"
        ? data.title
        : filename.replace(/^T-\d+-/, "").replace(/-/g, " ");

    // Priority: validate against known values
    const rawPriority =
      typeof data.priority === "string" ? data.priority.toLowerCase() : null;
    const priority =
      rawPriority && VALID_PRIORITIES.includes(rawPriority as TaskPriority)
        ? (rawPriority as TaskPriority)
        : null;

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
      priority,
      agent: typeof data.agent === "string" ? data.agent : null,
      worktree: typeof data.worktree === "string" ? data.worktree : null,
      branch: typeof data.branch === "string" ? data.branch : null,
      created:
        typeof data.created === "string"
          ? data.created
          : data.created instanceof Date
            ? data.created.toISOString().split("T")[0]
            : null,
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      decisions: Array.isArray(data.decisions)
        ? data.decisions.map(String)
        : [],
      milestone: typeof data.milestone === "string" ? data.milestone : null,
      description,
      dodTotal,
      dodDone,
      filePath,
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
        const filePath = path.join(dirPath, entry);
        const task = await parseTaskFile(filePath, status);
        if (task) tasks.push(task);
      }
    } catch {
      // Directory may not exist yet — that's fine
    }
  }

  return tasks;
}
```

**Important details:**

- All file I/O uses `fs.promises` (async) to avoid blocking the main process event loop during scans of large task directories.
- `gray-matter` parses YAML dates as `Date` objects — the `created` field handler accounts for this.
- Description extraction: scans body lines, skips headings (`#`), blank lines, and DoD checklist items (`- [`). Takes the first contiguous block of content, joins with spaces, truncates to 200 chars.
- If a file fails to parse (corrupt YAML, binary file, permission error), log a warning and skip it. Never crash the scan.

---

## Step 3 — Milestone file parser (main process)

**File:** `src/main/milestones.ts`

```ts
import matter from "gray-matter";
import * as fs from "fs";
import * as path from "path";
import type { MilestoneInfo, MilestoneStatus, TaskInfo } from "@shared/types";

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
```

**Key detail:** `scanMilestones` accepts a pre-scanned `tasks` array. This is essential for the atomic data approach — both tasks and milestones are scanned in the same IPC call, ensuring `taskCounts` are always consistent with the rendered task list.

---

## Step 4 — Directory initialization

**File:** `src/main/tasks.ts` (add function)

```ts
export async function initTaskDirs(workspacePath: string): Promise<void> {
  const taskBase = path.join(workspacePath, ".tasks");
  for (const dir of STATUS_DIRS) {
    await fs.promises.mkdir(path.join(taskBase, dir), { recursive: true });
  }
}
```

**File:** `src/main/milestones.ts` (add function)

```ts
export async function initMilestoneDirs(workspacePath: string): Promise<void> {
  await fs.promises.mkdir(path.join(workspacePath, ".milestones"), {
    recursive: true,
  });
}
```

Directory initialization is split by module (tasks.ts creates `.tasks/` dirs, milestones.ts creates `.milestones/`). Both are called once on workspace activation — **not** on every data fetch. Use `{ recursive: true }` for idempotency.

---

## Step 5 — Filesystem watchers (main process)

**File:** `src/main/watchers.ts`

```ts
import chokidar from "chokidar";
import * as path from "path";
import type { BrowserWindow } from "electron";

let taskWatcher: chokidar.FSWatcher | null = null;
let milestoneWatcher: chokidar.FSWatcher | null = null;

export function startWatchers(
  workspacePath: string,
  mainWindow: BrowserWindow,
): void {
  stopWatchers();

  taskWatcher = chokidar.watch(
    path.join(workspacePath, ".tasks", "**", "*.md"),
    {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    },
  );

  taskWatcher.on("all", () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("workspace:dataChanged");
    }
  });

  milestoneWatcher = chokidar.watch(
    path.join(workspacePath, ".milestones", "*.md"),
    {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    },
  );

  milestoneWatcher.on("all", () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("workspace:dataChanged");
    }
  });
}

export function stopWatchers(): void {
  taskWatcher?.close();
  milestoneWatcher?.close();
  taskWatcher = null;
  milestoneWatcher = null;
}
```

**Design notes:**

- Both task and milestone file changes send the same `workspace:dataChanged` event. Since we use a single atomic `workspace:data` IPC handler (Step 6), the renderer always re-fetches both together. This eliminates stale cross-references.
- Module-level mutable state for watchers matches the existing pattern in `workspace.ts:9` (`headWatcher`). This works because there's only ever one active workspace. If multi-window support is added later, this should be refactored to a class or Map keyed by workspace path.
- `stopWatchers()` is called first inside `startWatchers()` to clean up before switching workspaces.

---

## Step 6 — IPC handler: atomic workspace data

**File:** `src/main/ipc/tasks.ts`

Instead of separate `tasks:list` and `milestones:list` handlers, use a single atomic handler that returns both in one call. This solves:

1. **Consistency**: milestone `taskCounts` are always computed from the exact same task list the board displays.
2. **Performance**: one task scan serves both tasks and milestones, avoiding a redundant O(N) rescan.

```ts
import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import type { IpcResult, WorkspaceData } from "@shared/types";
import { scanTasks, initTaskDirs } from "../tasks";
import { scanMilestones, initMilestoneDirs } from "../milestones";
import { startWatchers, stopWatchers } from "../watchers";

export function registerTaskHandlers(
  configManager: ConfigManager,
  mainWindow: BrowserWindow,
): void {
  // Atomic data fetch — returns tasks + milestones in one response
  ipcMain.handle(
    "workspace:data",
    async (
      _event,
      workspacePath: string,
    ): Promise<IpcResult<WorkspaceData>> => {
      try {
        const tasks = await scanTasks(workspacePath);
        const milestones = await scanMilestones(workspacePath, tasks);
        return { ok: true, data: { tasks, milestones } };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}
```

**Watcher lifecycle wiring:**

Update `src/main/ipc/workspace.ts` to integrate watchers into the workspace activation flow:

```ts
// In workspace:setActive handler, after updating config:
import { startWatchers } from "../watchers";
import { initTaskDirs } from "../tasks";
import { initMilestoneDirs } from "../milestones";

// Inside the handler:
await initTaskDirs(wPath);
await initMilestoneDirs(wPath);
startWatchers(wPath, mainWindow);
startBranchWatcher(wPath, mainWindow);
```

**On app launch:** The workspace restored from `lastActiveWorkspace` also needs watchers started. Add initialization in `registerWorkspaceHandlers` (or a new `workspace:init` IPC call from the renderer). The safest approach: when `fetchWorkspaces` runs on mount, the renderer calls `workspace:setActive` for the last active workspace, which triggers watcher setup.

**Register in `src/main/ipc/index.ts`:**

```ts
import { registerTaskHandlers } from "./tasks";

export function registerIpcHandlers(configManager, mainWindow) {
  registerWorkspaceHandlers(configManager, mainWindow);
  registerTaskHandlers(configManager, mainWindow);
  ipcMain.handle("app:getPlatform", () => process.platform);
}
```

**Watcher cleanup in `src/main/index.ts`:**

```ts
import { stopWatchers } from "./watchers";

app.on("before-quit", () => {
  stopBranchWatcher();
  stopWatchers();
  if (configManager) configManager.flushSync();
});
```

Also export `stopWatchers` from `watchers.ts` and call it from `workspace:remove` if the removed workspace was the active one.

---

## Step 7 — Preload API extension

**File:** `src/preload/index.ts`

Add the workspace data IPC binding:

```ts
contextBridge.exposeInMainWorld("api", {
  workspaces: {
    /* existing */
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
  app: {
    /* existing */
  },
});
```

**File:** `src/preload/index.d.ts`

Extend `ElectronAPI`:

```ts
import type {
  WorkspaceInfo,
  WorkspaceEntry,
  WorkspaceData,
  IpcResult,
} from "@shared/types";

export interface ElectronAPI {
  workspaces: {
    /* existing */
  };
  data: {
    fetch: (workspacePath: string) => Promise<IpcResult<WorkspaceData>>;
    onChanged: (callback: () => void) => () => void;
  };
  app: {
    /* existing */
  };
}
```

**Why `data` instead of separate `tasks` and `milestones`:** The atomic approach means one IPC channel, one preload binding, one store action, one event listener. Simpler wiring, guaranteed consistency.

---

## Step 8 — Zustand stores (renderer)

### Workspace data store

**File:** `src/renderer/src/stores/useDataStore.ts`

A single store for workspace-scoped data (tasks + milestones). This replaces the originally planned separate `useTaskStore` and `useMilestoneStore` to match the atomic IPC model.

```ts
import { create } from "zustand";
import type { TaskInfo, MilestoneInfo } from "@shared/types";
import { useWorkspaceStore } from "./useWorkspaceStore";

interface DataState {
  tasks: TaskInfo[];
  milestones: MilestoneInfo[];
  loading: boolean;
  error: string | null;
  milestoneFilter: string | null; // milestone ID, 'none', or null (= all)
  selectedMilestoneId: string | null; // for detail panel

  fetchData: () => void; // debounced
  setMilestoneFilter: (filter: string | null) => void;
  setSelectedMilestone: (id: string | null) => void;
  clear: () => void; // reset on workspace switch
}

let fetchTimer: ReturnType<typeof setTimeout> | null = null;

export const useDataStore = create<DataState>()((set) => ({
  tasks: [],
  milestones: [],
  loading: false,
  error: null,
  milestoneFilter: null,
  selectedMilestoneId: null,

  fetchData: () => {
    // Debounce: wait 200ms before executing. If called again within that
    // window, restart the timer. This coalesces rapid chokidar events.
    // Do NOT set loading=true until the debounce fires — prevents UI flicker.
    if (fetchTimer) clearTimeout(fetchTimer);
    fetchTimer = setTimeout(async () => {
      const workspacePath = useWorkspaceStore.getState().activeWorkspacePath;
      if (!workspacePath) return;
      set({ loading: true });
      try {
        const result = await window.api.data.fetch(workspacePath);
        if (result.ok) {
          set({
            tasks: result.data.tasks,
            milestones: result.data.milestones,
            loading: false,
            error: null,
          });
        } else {
          set({ loading: false, error: result.error });
        }
      } catch (err) {
        set({
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, 200);
  },

  setMilestoneFilter: (filter) => set({ milestoneFilter: filter }),
  setSelectedMilestone: (id) => set({ selectedMilestoneId: id }),

  clear: () =>
    set({
      tasks: [],
      milestones: [],
      loading: false,
      error: null,
      milestoneFilter: null,
      selectedMilestoneId: null,
    }),
}));
```

**Debounce details:**

- `loading` is only set to `true` when the debounce fires, not immediately on call. This prevents the UI flickering to a loading skeleton on every rapid chokidar event.
- The timer is module-scoped, not instance-scoped, which is fine because Zustand stores are singletons.

**Milestone filtering is done in components via `useMemo`**, not in the store. The store only holds the filter value. This follows the Zustand best practice of keeping derived state out of the store.

### Nav store update

**File:** `src/renderer/src/stores/useNavStore.ts`

Add `'milestones'` to the `View` union type:

```ts
export type View = "board" | "milestones" | "decisions" | "terminal";
```

---

## Step 9 — Wire up data fetching and live updates

**File:** `src/renderer/src/App.tsx`

Add effects to the `AppContent` component:

```tsx
const fetchData = useDataStore((s) => s.fetchData);
const clearData = useDataStore((s) => s.clear);

// Clear stale data immediately on workspace switch, then fetch fresh
useEffect(() => {
  clearData();
  if (activeWorkspacePath) {
    fetchData();
  }
}, [activeWorkspacePath, clearData, fetchData]);

// Live update listener — re-fetch when files change on disk
useEffect(() => {
  const unsub = window.api.data.onChanged(() => {
    fetchData(); // debounced in store — safe to call rapidly
  });
  return unsub;
}, [fetchData]);
```

**Stale data prevention:** `clearData()` is called immediately on workspace switch, before the async fetch. This ensures the user never sees the old workspace's tasks under the new workspace's name.

---

## Step 10 — Kanban board component

**File:** `src/renderer/src/components/Board/Board.tsx`
**File:** `src/renderer/src/components/Board/Board.module.css`

Layout: horizontal flex container with four columns. Each column scrolls independently.

```tsx
import { useMemo } from "react";
import { useDataStore } from "../../stores/useDataStore";
import type { TaskStatus } from "@shared/types";
import { Column } from "./Column";
import { BoardToolbar } from "./BoardToolbar";
import styles from "./Board.module.css";

const COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: "backlog", label: "BACKLOG", color: "var(--text-lo)" },
  { status: "doing", label: "DOING", color: "var(--status-green)" },
  { status: "review", label: "REVIEW", color: "var(--status-amber)" },
  { status: "done", label: "DONE", color: "var(--status-green)" },
];

export function Board(): React.JSX.Element {
  const tasks = useDataStore((s) => s.tasks);
  const milestones = useDataStore((s) => s.milestones);
  const milestoneFilter = useDataStore((s) => s.milestoneFilter);
  const loading = useDataStore((s) => s.loading);

  // Filter tasks by milestone
  const filtered = useMemo(() => {
    if (milestoneFilter === null) return tasks;
    if (milestoneFilter === "none") return tasks.filter((t) => !t.milestone);
    return tasks.filter((t) => t.milestone === milestoneFilter);
  }, [tasks, milestoneFilter]);

  // Build milestone ID → title lookup for card rendering
  const milestoneMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of milestones) map.set(m.id, m.title);
    return map;
  }, [milestones]);

  if (loading && tasks.length === 0) {
    return (
      <div className={styles.board}>
        <div className={styles.loading}>Loading tasks...</div>
      </div>
    );
  }

  if (!loading && tasks.length === 0) {
    return (
      <div className={styles.board}>
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>No tasks yet</div>
          <div className={styles.emptyHint}>
            Create a Markdown file in .tasks/backlog/ to get started
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.board}>
      <BoardToolbar milestones={milestones} />
      <div className={styles.columns}>
        {COLUMNS.map((col) => {
          const colTasks = filtered.filter((t) => t.status === col.status);
          return (
            <Column
              key={col.status}
              {...col}
              tasks={colTasks}
              milestoneMap={milestoneMap}
            />
          );
        })}
      </div>
    </div>
  );
}
```

### BoardToolbar

**File:** `src/renderer/src/components/Board/BoardToolbar.tsx`

Milestone filter dropdown:

- Default label: "All tasks"
- Options: "All tasks", "No milestone", then each open milestone by title
- Selecting calls `setMilestoneFilter` on the data store

Style: toolbar at top of board area, `height: 40px`, `padding: 0 16px`, flex row with items right-aligned. Dropdown: `select` element with custom styling (background `--bg-surface`, border `--border`, text `--text-secondary`, `--font-ui` 12px, `--radius-sm` corners).

---

## Step 11 — Column component

**File:** `src/renderer/src/components/Board/Column.tsx`
**File:** `src/renderer/src/components/Board/Column.module.css`

```tsx
interface ColumnProps {
  status: TaskStatus;
  label: string;
  color: string;
  tasks: TaskInfo[];
  milestoneMap: Map<string, string>;
}
```

Structure:

- **Header**: colored dot (8px circle, `background: color`) + uppercase label (`--font-ui`, 11px, letter-spacing 0.5px) + count badge (muted)
- **Card list**: vertical stack of `TaskCard` components, scrollable via `overflow-y: auto`
- **Footer**: "Add ticket" placeholder — `+ Add ticket` text in `--text-lo`, cursor default (not functional in Phase 2)

CSS: columns fill available space equally via `flex: 1`, `min-width: 220px`, gap `12px`. Column has subtle border-right `1px solid var(--border-dim)` (last column no border). Card list has `padding: 8px` and `gap: 8px`.

---

## Step 12 — TaskCard component

**File:** `src/renderer/src/components/Board/TaskCard.tsx`
**File:** `src/renderer/src/components/Board/TaskCard.module.css`

```tsx
interface TaskCardProps {
  task: TaskInfo;
  milestoneName: string | null; // resolved by parent from milestoneMap
}
```

**Layout (top to bottom):**

1. **Row 1**: Title (left, `--text-primary`, normal weight, `--font-ui` 13px) + Priority badge (right, only rendered when `task.priority !== null`)
2. **Row 2**: Description preview (1-2 lines, `--text-secondary`, 12px, truncated with CSS `-webkit-line-clamp: 2`)
3. **Row 3**: Tag pills (flex-wrap, gap `4px`)
4. **Row 4** (conditional): Milestone label — only when `task.milestone` is set

**Priority badge styling:**

- Small pill: `padding: 1px 6px`, uppercase text, `--font-mono` 10px, `border-radius: var(--radius-sm)`
- Colors:
  - `critical`: `--status-red` bg, white text
  - `high`: `--status-amber` bg, `#1a1a22` text
  - `medium`: `--status-blue` bg, white text
  - `low`: `--text-lo` at 20% opacity bg, `--text-lo` text
- When `priority` is `null`: don't render the badge. Title takes full width.

**Tag pills:** `border: 1px solid var(--border)`, `--text-lo` text, `--font-mono` 10px, `--radius-sm` corners, `padding: 1px 6px`.

**Milestone label:** Diamond glyph (`◆`) in `--accent` color + milestone title in `--text-lo`, `--font-ui` 11px. On click: `e.stopPropagation()` (prevent card selection in Phase 4), then call `useNavStore.getState().setActiveView('milestones')` and `useDataStore.getState().setSelectedMilestone(task.milestone)`.

If the milestone ID doesn't resolve to a name (orphaned reference), show the raw ID instead (e.g. `◆ M-999`).

**Card container:**

- `background: var(--bg-surface)`
- `border: 1px solid var(--border-dim)`
- `border-radius: var(--radius-md)`
- `padding: 12px`
- Hover: `background: var(--bg-hover)`, `transition: background var(--transition-fast)`
- Selected state (Phase 4): `border-color: var(--accent)`

**Milestone name resolution:** The parent `Column` component receives `milestoneMap` and resolves milestone IDs to titles, passing `milestoneName` as a prop. This avoids each card doing a store lookup.

---

## Step 13 — Milestone list view

**File:** `src/renderer/src/components/Milestones/MilestoneList.tsx`
**File:** `src/renderer/src/components/Milestones/MilestoneList.module.css`

Renders when `activeView === 'milestones'`.

```tsx
export function MilestoneList(): React.JSX.Element {
  const milestones = useDataStore((s) => s.milestones);
  const selectedId = useDataStore((s) => s.selectedMilestoneId);
  const setSelected = useDataStore((s) => s.setSelectedMilestone);

  // Sort: open first, then closed. Within group, newest first.
  const sorted = useMemo(() => {
    return [...milestones].sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return (b.created || "").localeCompare(a.created || "");
    });
  }, [milestones]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Milestones</h2>
        {/* "New milestone" button — placeholder for Phase 4 */}
      </div>
      <div className={styles.list}>
        {sorted.map((m) => (
          <MilestoneRow
            key={m.id}
            milestone={m}
            isSelected={m.id === selectedId}
            onClick={() => setSelected(m.id === selectedId ? null : m.id)}
          />
        ))}
        {sorted.length === 0 && (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>No milestones yet</div>
            <div className={styles.emptyHint}>
              Create a Markdown file in .milestones/ to get started
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

### MilestoneRow

**File:** `src/renderer/src/components/Milestones/MilestoneRow.tsx`
**File:** `src/renderer/src/components/Milestones/MilestoneRow.module.css`

Each row shows:

- Diamond icon (`◆`) in `--accent`
- Title in `--text-primary`, `--font-ui` 14px
- Status badge: `OPEN` (green bg, `--status-green`) or `CLOSED` (`--text-lo` bg) — small pill, `--font-mono` 10px
- Tag pills (same style as task tags)
- Progress bar: thin horizontal bar (`4px` tall, `--radius-sm` corners), fill `--status-green`, track `--bg-hover`. Width = `taskCounts.done / taskCounts.total * 100%`. **Hidden** if `taskCounts.total === 0`.
- Task count: `{done}/{total} tasks` in `--text-secondary`, `--font-mono` 11px

Row styling: `padding: 12px 16px`, `border-bottom: 1px solid var(--border-dim)`, hover `background: var(--bg-hover)`. Selected row: `background: var(--bg-active)`.

---

## Step 14 — Milestone detail panel (read-only in Phase 2)

**File:** `src/renderer/src/components/Milestones/MilestoneDetail.tsx`
**File:** `src/renderer/src/components/Milestones/MilestoneDetail.module.css`

Read-only in Phase 2. Editing comes in Phase 4.

When `selectedMilestoneId` is set, render a detail panel on the right side:

- **Header**: ID badge (`M-001`, `--font-mono`, `--accent` bg, `--radius-sm`), title, status badge. Close button (`x`) in top-right → calls `setSelectedMilestone(null)`.
- **Description**: body text in `--text-secondary`, `--font-ui` 13px. Plain text rendering (no Markdown rich rendering needed in Phase 2).
- **Linked tasks**: grouped by status (backlog / doing / review / done). Each group has a heading with status dot + label + count. Each task as a mini row: status dot (same colors as column headers) + title (`--text-primary`) + priority badge (if set). Clicking a task: switch to board view, set milestone filter to current milestone. Don't attempt to select/highlight the specific task (that's Phase 4).
- **Progress**: `N of M tasks complete` + progress bar (same style as MilestoneRow).

**Panel layout:** Fixed width `360px`, `border-left: 1px solid var(--border)`, `background: var(--bg-surface)`, `overflow-y: auto`. Panel appears alongside the list (flex layout — list takes `flex: 1`, panel is fixed width).

---

## Step 15 — Update MainArea to route views

**File:** `src/renderer/src/components/MainArea/MainArea.tsx`

Replace the placeholder board view with the real `Board` component. Add the milestones view:

```tsx
import { Board } from "../Board/Board";
import { MilestoneList } from "../Milestones/MilestoneList";
import { MilestoneDetail } from "../Milestones/MilestoneDetail";
import { useDataStore } from "../../stores/useDataStore";

// In the component:
const selectedMilestoneId = useDataStore((s) => s.selectedMilestoneId);

if (activeView === "board") {
  return (
    <div className={styles.mainArea}>
      <Board />
    </div>
  );
}

if (activeView === "milestones") {
  return (
    <div className={styles.mainAreaWithPanel}>
      <MilestoneList />
      {selectedMilestoneId && <MilestoneDetail />}
    </div>
  );
}
```

**CSS:** Add `mainAreaWithPanel` class to `MainArea.module.css`:

```css
.mainAreaWithPanel {
  display: flex;
  flex: 1;
  overflow: hidden;
}
```

This creates a horizontal flex container where `MilestoneList` takes `flex: 1` and `MilestoneDetail` is fixed at `360px`.

---

## Step 16 — Update BottomNav

**File:** `src/renderer/src/components/Sidebar/BottomNav.tsx`

Add the Milestones nav item between Task Board and Decisions:

```tsx
{
  id: 'milestones' as View,
  label: 'Milestones',
  icon: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 1L14.5 8L8 15L1.5 8L8 1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}
```

The diamond SVG matches the `◆` glyph used in task cards.

---

## Step 17 — Workspace doing-count badge

**File:** `src/renderer/src/components/Sidebar/WorkspaceItem.tsx`

Hide the badge for non-active workspaces entirely (displaying `[0]` for inactive workspaces is misleading since we don't scan their tasks). For the active workspace, show the real count:

```tsx
const tasks = useDataStore((s) => s.tasks);
const isActive = workspace.path === activeWorkspacePath;

// Only show badge for active workspace with doing tasks
const doingCount = isActive
  ? tasks.filter((t) => t.status === "doing").length
  : 0;
const showBadge = isActive && doingCount > 0;
```

Display the badge only when `showBadge` is true. This replaces the placeholder `[0]`.

---

## File creation summary

| File                                                                | Type     | Description                                                                             |
| ------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `src/shared/types.ts`                                               | **Edit** | Add `TaskInfo`, `MilestoneInfo`, `WorkspaceData`, status/priority types                 |
| `src/main/tasks.ts`                                                 | **New**  | Task file parser + scanner + directory initializer                                      |
| `src/main/milestones.ts`                                            | **New**  | Milestone file parser + scanner + directory initializer                                 |
| `src/main/watchers.ts`                                              | **New**  | Chokidar watcher manager                                                                |
| `src/main/ipc/tasks.ts`                                             | **New**  | IPC handler: `workspace:data` (atomic tasks + milestones)                               |
| `src/main/ipc/index.ts`                                             | **Edit** | Register task handlers                                                                  |
| `src/main/ipc/workspace.ts`                                         | **Edit** | Wire up `initTaskDirs`, `initMilestoneDirs`, `startWatchers` into `workspace:setActive` |
| `src/main/index.ts`                                                 | **Edit** | Stop watchers on quit                                                                   |
| `src/preload/index.ts`                                              | **Edit** | Add `data` API bridge                                                                   |
| `src/preload/index.d.ts`                                            | **Edit** | Add type declarations for `data` API                                                    |
| `src/renderer/src/stores/useDataStore.ts`                           | **New**  | Combined task + milestone state with debounced fetch                                    |
| `src/renderer/src/stores/useNavStore.ts`                            | **Edit** | Add `'milestones'` to `View` type                                                       |
| `src/renderer/src/App.tsx`                                          | **Edit** | Wire up data fetch + change listener + workspace switch cleanup                         |
| `src/renderer/src/components/Board/Board.tsx`                       | **New**  | Kanban board with columns + empty/loading states                                        |
| `src/renderer/src/components/Board/Board.module.css`                | **New**  | Board layout styles                                                                     |
| `src/renderer/src/components/Board/BoardToolbar.tsx`                | **New**  | Milestone filter dropdown                                                               |
| `src/renderer/src/components/Board/Column.tsx`                      | **New**  | Single kanban column                                                                    |
| `src/renderer/src/components/Board/Column.module.css`               | **New**  | Column styles                                                                           |
| `src/renderer/src/components/Board/TaskCard.tsx`                    | **New**  | Task card with milestone label                                                          |
| `src/renderer/src/components/Board/TaskCard.module.css`             | **New**  | Card styles                                                                             |
| `src/renderer/src/components/Milestones/MilestoneList.tsx`          | **New**  | Milestone list view                                                                     |
| `src/renderer/src/components/Milestones/MilestoneList.module.css`   | **New**  | List styles                                                                             |
| `src/renderer/src/components/Milestones/MilestoneRow.tsx`           | **New**  | Single milestone row                                                                    |
| `src/renderer/src/components/Milestones/MilestoneRow.module.css`    | **New**  | Row styles                                                                              |
| `src/renderer/src/components/Milestones/MilestoneDetail.tsx`        | **New**  | Milestone detail panel (read-only)                                                      |
| `src/renderer/src/components/Milestones/MilestoneDetail.module.css` | **New**  | Detail panel styles                                                                     |
| `src/renderer/src/components/MainArea/MainArea.tsx`                 | **Edit** | Route board + milestones views                                                          |
| `src/renderer/src/components/MainArea/MainArea.module.css`          | **Edit** | Add `mainAreaWithPanel` class                                                           |
| `src/renderer/src/components/Sidebar/BottomNav.tsx`                 | **Edit** | Add Milestones nav item                                                                 |
| `src/renderer/src/components/Sidebar/WorkspaceItem.tsx`             | **Edit** | Wire up doing-count badge                                                               |

**Styling note:** New Board and Milestone components use CSS modules (`.module.css`). Existing sidebar components use inline styles (matching Phase 1 patterns). Refactoring sidebar to CSS modules is out of scope for Phase 2.

---

## Implementation order

Build bottom-up: data layer first, then UI.

1. **Types** (Step 1) — shared types all code depends on
2. **Parsers** (Steps 2-3) — task and milestone file parsing (async I/O)
3. **Directory init** (Step 4) — split across tasks.ts and milestones.ts
4. **Watchers** (Step 5) — chokidar setup with unified `workspace:dataChanged` event
5. **IPC handler** (Step 6) — atomic `workspace:data` endpoint + wiring into `workspace:setActive`
6. **Preload** (Step 7) — bridge the IPC to renderer
7. **Store** (Step 8) — single `useDataStore` with debounced fetch
8. **Data wiring** (Step 9) — fetch on workspace change, live updates, stale data clearing
9. **Nav updates** (Steps 15-16) — add milestones view to nav and MainArea routing
10. **Board UI** (Steps 10-12) — Board, Column, TaskCard components with loading/empty states
11. **Milestone UI** (Steps 13-14) — MilestoneList, MilestoneRow, MilestoneDetail
12. **Workspace badge** (Step 17) — doing-count on sidebar (active workspace only)

---

## Testing strategy

### Manual testing workflow

1. **Create test fixtures:** Place sample `.md` files in `.tasks/{backlog,doing,review,done}/` and `.milestones/` in a test workspace. Use the formats from VISION.md. Include at least one file with `priority` set and one without. Include a task with a `milestone` reference and one without.

2. **Task scanning:** Verify `workspace:data` returns correct task data — check frontmatter fields, DoD counts, description preview truncation, priority parsing, milestone IDs.

3. **Milestone scanning:** Verify milestones have correct `taskCounts` matching the task data in the same response.

4. **Live updates:** With the app running, add/modify/delete a `.md` file in `.tasks/` via the terminal or file manager. The board should update within ~1 second.

5. **Milestone filter:** Set a milestone filter on the board. Verify only matching cards show. Verify column counts update. Switch to "No milestone" — verify only unassigned tasks show.

6. **Milestone navigation:** Click a milestone label on a task card. Verify it switches to milestones view and selects that milestone in the detail panel.

7. **Workspace switching:** Switch workspaces. Verify the board clears immediately (no flash of old data) and repopulates with the new workspace's tasks. Verify the milestone filter resets.

8. **Edge cases:**
   - Workspace with no `.tasks/` directory (should auto-create on activation)
   - Task file with missing/corrupt frontmatter (should skip gracefully, other tasks still render)
   - Task file with no `priority` field (card renders without priority badge, title takes full width)
   - Task file with no `id` or `title` in frontmatter (falls back to filename-derived values)
   - Task with `milestone: M-999` referencing non-existent milestone (shows raw ID as label)
   - Empty milestone (no linked tasks) — progress bar hidden, shows `0/0 tasks`
   - Rapid file changes (rename, bulk delete) — app debounces correctly, no stale data
   - Board with 0 tasks — empty state message shown
   - Board loading — loading state shown on initial fetch

### Build verification

```bash
npm run typecheck    # Ensure no type errors across all three tsconfig targets
npm run lint         # ESLint passes
npm run build        # Production build succeeds
```

---

## Acceptance criteria

Phase 2 is **done** when:

1. Drop a `.md` file into `.tasks/doing/` and the card appears in the Doing column within one second, with correct title, priority badge (when present), description preview, tags, DoD progress, and milestone label.
2. Board shows loading state on initial fetch and empty state when no tasks exist.
3. Milestone list view shows all milestones with computed progress bars and task counts.
4. Clicking a milestone label on a task card navigates to the milestone view and selects that milestone.
5. Milestone filter dropdown on the board filters cards by milestone (including "No milestone" option).
6. Milestone detail panel shows linked tasks grouped by status with a progress summary.
7. Live updates work — modifying files on disk is reflected in the UI within ~1 second.
8. Switching workspaces clears old data immediately and loads new workspace data.
9. Workspace doing-count badge shows correctly for the active workspace, hidden for inactive workspaces.
10. `npm run typecheck && npm run build` passes cleanly.
