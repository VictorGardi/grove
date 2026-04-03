# Phase 4 — Task Detail Panel + CRUD + Milestone CRUD

## Implementation Plan

**Goal:** Turn the app from read-only into a fully functional task management tool. Click a card to see full detail. Create, edit, move, and delete tasks. Full milestone lifecycle with create, edit, close, and task linking.

**Prerequisite:** Phases 1–3 complete (workspace management, kanban board, milestones list, file tree, file viewer).

---

## Part 1 — Main Process Write Infrastructure

All filesystem mutations go through the main process. The renderer never writes files directly.

### 1.1 Atomic File Write Utility

**File:** `src/main/fileWriter.ts`

Create a shared utility modeled after `ConfigManager.writeToDisk()`:

```ts
export async function atomicWrite(
  filePath: string,
  content: string,
): Promise<void>;
```

- Write to `<filePath>.tmp`, then `fs.rename` to `<filePath>`
- Ensures parent directory exists before writing
- Used by all task and milestone write operations
- **Important:** Add `ignored: /\.tmp$/` to all chokidar watchers in `watchers.ts` to avoid spurious events from temp files during atomic writes

### 1.2 Task Write Operations

**File:** `src/main/tasks.ts` (extend existing)

Add the following functions:

```ts
// Generate next task ID by scanning all .tasks/{backlog,doing,review,done,archive}/*.md
// Uses a module-level session counter to prevent TOCTOU race conditions
// on rapid successive creates: max(filesystem_scan, lastGeneratedId) + 1
export async function nextTaskId(workspacePath: string): Promise<string>;

// Serialize frontmatter + body into a markdown string using gray-matter.stringify()
export function serializeTask(
  frontmatter: Record<string, unknown>,
  body: string,
): string;

// Create a new task file in .tasks/backlog/ with generated ID
// Filename: T-XXX-<slug>.md (slug derived from title, lowercase, hyphens, max 50 chars)
// Filenames are immutable after creation — only the frontmatter title changes on edit
export async function createTask(
  workspacePath: string,
  title: string,
): Promise<TaskInfo>;

// Read-merge-write: reads current file, merges only the changed fields, writes back.
// This prevents overwriting concurrent agent edits with stale renderer state.
// `changes` is a partial object of frontmatter fields to update.
// `body` is optional — if provided, replaces the entire body section.
export async function updateTask(
  workspacePath: string,
  filePath: string,
  changes: Partial<TaskFrontmatter>,
  body?: string,
): Promise<void>;

// Move task file between status directories (backlog/ -> doing/, etc.)
// Uses the task's filePath to locate the file (no directory scanning needed).
// Operation: read file → update status in frontmatter → atomic write to new dir → delete old file.
// If delete fails after write, logs a warning (duplicate, but no data loss).
export async function moveTask(
  workspacePath: string,
  filePath: string,
  toStatus: TaskStatus,
): Promise<void>;

// Archive a task (move to .tasks/archive/, never hard-delete)
// Same read-modify-write-delete pattern as moveTask.
export async function archiveTask(
  workspacePath: string,
  filePath: string,
): Promise<void>;

// Read full task body (not truncated, unlike scanTasks which truncates description to 200 chars)
// Validates that filePath starts with workspacePath to prevent path traversal.
export async function readTaskBody(
  workspacePath: string,
  filePath: string,
): Promise<string>;
```

**Key design decisions (from review):**

1. **Read-merge-write for updates:** The `updateTask` function does NOT take a full `TaskInfo` from the renderer. Instead it reads the current file from disk, merges only the changed fields, and writes back. This prevents data loss when the renderer has stale state (e.g., an agent modified the file between the last `fetchData()` and the user's edit).

2. **ID generation race protection:** A module-level `let lastGeneratedId: number = 0` caches the last generated ID within the session. `nextTaskId` returns `max(filesystem_scan_max, lastGeneratedId) + 1` and updates the cache. Since Electron's main process JS is single-threaded, this prevents duplicate IDs from rapid successive `task:create` calls.

3. **`filePath`-based signatures:** All mutation functions use `filePath` (which the renderer already has from `TaskInfo.filePath`) instead of `taskId + status`. This avoids redundant directory scans and is consistent across operations.

4. **Path traversal protection:** `readTaskBody` and all write operations validate that the target path starts with `workspacePath` before reading/writing.

**Frontmatter type:**

```ts
// Add to src/shared/types.ts
export interface TaskFrontmatter {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  agent: string | null;
  worktree: string | null;
  branch: string | null;
  created: string | null;
  tags: string[];
  decisions: string[];
  milestone: string | null;
}
```

**ID format:** `T-{n}` where `n` is zero-padded to at least 3 digits but grows naturally (T-001, T-999, T-1000). Never truncate.

**Slug generation:** `title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)`

### 1.3 Milestone Write Operations

**File:** `src/main/milestones.ts` (extend existing)

```ts
// Same session-counter race protection as task IDs
export async function nextMilestoneId(workspacePath: string): Promise<string>;

export function serializeMilestone(
  frontmatter: Record<string, unknown>,
  body: string,
): string;

export async function createMilestone(
  workspacePath: string,
  title: string,
): Promise<MilestoneInfo>;

// Read-merge-write pattern, same as updateTask
export async function updateMilestone(
  workspacePath: string,
  filePath: string,
  changes: Partial<MilestoneFrontmatter>,
  body?: string,
): Promise<void>;

// Validates path traversal before reading
export async function readMilestoneBody(
  workspacePath: string,
  filePath: string,
): Promise<string>;
```

### 1.4 New IPC Handlers

**File:** `src/main/ipc/tasks.ts` (extend existing)

Register the following new channels:

| Channel              | Signature                                                      | Description                |
| -------------------- | -------------------------------------------------------------- | -------------------------- |
| `task:create`        | `(workspacePath, title) => IpcResult<TaskInfo>`                | Create new task in backlog |
| `task:update`        | `(workspacePath, filePath, changes, body?) => IpcResult<void>` | Read-merge-write update    |
| `task:move`          | `(workspacePath, filePath, toStatus) => IpcResult<void>`       | Move between status dirs   |
| `task:archive`       | `(workspacePath, filePath) => IpcResult<void>`                 | Move to archive            |
| `task:readBody`      | `(workspacePath, filePath) => IpcResult<string>`               | Read full untruncated body |
| `milestone:create`   | `(workspacePath, title) => IpcResult<MilestoneInfo>`           | Create new milestone       |
| `milestone:update`   | `(workspacePath, filePath, changes, body?) => IpcResult<void>` | Read-merge-write update    |
| `milestone:readBody` | `(workspacePath, filePath) => IpcResult<string>`               | Read full body             |

**All handlers must:**

- Validate `workspacePath` is a registered workspace (match existing pattern from `ipc/filesystem.ts`)
- Validate `filePath` is within `workspacePath` (path traversal protection)
- Validate `title` is non-empty and doesn't contain control characters
- Return `IpcResult<T>` (consistent with existing pattern: `{ ok: true, data }` or `{ ok: false, error }`)

Ensure `initTaskDirs` creates `archive/` alongside the four status dirs.

### 1.5 Chokidar Update

**File:** `src/main/watchers.ts` (modify)

Add `ignored: /\.tmp$/` to the task watcher and milestone watcher configs to prevent spurious events from atomic write temp files.

### 1.6 Preload API Extension

**File:** `src/preload/index.ts` + `src/preload/index.d.ts`

Extend the `window.api` surface:

```ts
window.api = {
  // ... existing ...
  tasks: {
    create:   (workspacePath, title) => ipcRenderer.invoke('task:create', workspacePath, title),
    update:   (workspacePath, filePath, changes, body?) => ipcRenderer.invoke('task:update', ...),
    move:     (workspacePath, filePath, toStatus) => ipcRenderer.invoke('task:move', ...),
    archive:  (workspacePath, filePath) => ipcRenderer.invoke('task:archive', ...),
    readBody: (workspacePath, filePath) => ipcRenderer.invoke('task:readBody', ...),
  },
  milestones: {
    create:   (workspacePath, title) => ipcRenderer.invoke('milestone:create', ...),
    update:   (workspacePath, filePath, changes, body?) => ipcRenderer.invoke('milestone:update', ...),
    readBody: (workspacePath, filePath) => ipcRenderer.invoke('milestone:readBody', ...),
  },
}
```

Update `ElectronAPI` interface in `index.d.ts` with proper `IpcResult<T>` return types.

---

## Part 2 — Renderer State & Actions

### 2.1 Mutation Actions as Standalone Functions

**File:** `src/renderer/src/actions/taskActions.ts` (new)
**File:** `src/renderer/src/actions/milestoneActions.ts` (new)

Since mutation actions call IPC and rely on chokidar to refresh the store (they don't set state themselves), they don't belong in the Zustand store. Extract them as standalone async functions:

```ts
// src/renderer/src/actions/taskActions.ts
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { useDataStore } from '../stores/useDataStore'
import type { TaskStatus, TaskFrontmatter } from '@shared/types'

function getWorkspacePath(): string | null {
  return useWorkspaceStore.getState().activeWorkspacePath
}

export async function createTask(title: string): Promise<string | null> {
  const wp = getWorkspacePath()
  if (!wp) return null
  const result = await window.api.tasks.create(wp, title)
  if (!result.ok) { console.error('Failed to create task:', result.error); return null }
  // Auto-select the new task
  useDataStore.getState().setSelectedTask(result.data.id)
  return result.data.id
}

export async function updateTask(
  filePath: string,
  changes: Partial<TaskFrontmatter>,
  body?: string
): Promise<void> {
  const wp = getWorkspacePath()
  if (!wp) return
  const result = await window.api.tasks.update(wp, filePath, changes, body)
  if (!result.ok) console.error('Failed to update task:', result.error)
}

export async function moveTask(filePath: string, toStatus: TaskStatus): Promise<void> { ... }
export async function archiveTask(filePath: string): Promise<void> { ... }
```

```ts
// src/renderer/src/actions/milestoneActions.ts
export async function createMilestone(title: string): Promise<string | null> { ... }
export async function updateMilestone(
  filePath: string,
  changes: Partial<MilestoneFrontmatter>,
  body?: string
): Promise<void> { ... }
```

### 2.2 Store Extensions (Selection State Only)

**File:** `src/renderer/src/stores/useDataStore.ts` (extend)

Add only selection-related state (mutations live in actions):

```ts
// New state
selectedTaskId: string | null
selectedTaskBody: string | null       // full untruncated body (loaded on select)
taskDetailLoading: boolean
taskDetailDirty: boolean              // true when user has unsaved edits in the panel

// New actions
setSelectedTask: (id: string | null) => void   // sets ID, fetches body via task:readBody
setTaskDetailDirty: (dirty: boolean) => void
clearSelectedTask: () => void
```

**Key behaviors:**

- `setSelectedTask(id)`: sets `selectedTaskId`, calls `task:readBody` IPC to get full body, stores in `selectedTaskBody`, resets `taskDetailDirty` to false
- `fetchData()`: when `taskDetailDirty` is true, skip re-fetching the body of the selected task. This prevents clobbering in-flight edits when chokidar fires `workspace:dataChanged` due to an unrelated file change. The task list itself still refreshes (it only contains truncated descriptions).

### 2.3 Computed Selectors

```ts
export const useSelectedTask = () =>
  useDataStore((s) => s.tasks.find((t) => t.id === s.selectedTaskId) ?? null);
```

---

## Part 3 — Task Detail Panel (UI)

### 3.1 TaskDetailPanel Component

**File:** `src/renderer/src/components/TaskDetail/TaskDetailPanel.tsx` (own directory, not Board/)
**Styles:** `src/renderer/src/components/TaskDetail/TaskDetailPanel.module.css`

Placed in its own directory because it's accessed from both the board view and the milestone view (cross-navigation). Not a Board-specific component.

A 360px panel that slides in from the right when a task is selected. The board narrows to accommodate it — NOT a modal overlay. Panel content is scrollable (`overflow-y: auto`) with the header pinned at the top.

**Layout integration in `MainArea.tsx`:**

- When `activeView === 'board'` and `selectedTaskId` is set: render `<Board />` + `<TaskDetailPanel />` side by side in a flex container
- When no task selected: board takes full width
- CSS transition on the board's flex-basis for smooth panel open/close animation

**Panel sections (top to bottom):**

1. **Header bar** (pinned, non-scrolling)
   - ID badge (`T-004`) in mono font, muted background
   - Status tag (colored dot + label matching column colors)
   - Close button (×) — calls `clearSelectedTask()`

2. **Title**
   - Inline-editable via `<InlineEdit>` component
   - Blur/enter to save → calls `updateTask(filePath, { title: newTitle })`

3. **Priority picker**
   - Row of 4 small pill buttons: Critical / High / Medium / Low
   - Active one highlighted with its status color
   - Click to change → immediate `updateTask(filePath, { priority: newPriority })`

4. **Agent picker**
   - Native `<select>` dropdown: `claude-code`, `copilot`, `codex`, `aider`, `opencode`, plus empty option
   - Saves to `agent` frontmatter field on change

5. **Milestone picker**
   - Native `<select>` with all open milestones as options, plus "None"
   - Shows current milestone. "None" clears the field.
   - Saves `milestone: M-XXX` to frontmatter on change
   - (Upgraded to SearchableSelect in Phase 9 when decision linking needs it too)

6. **Tags**
   - `<TagInput>` component: shows tags as removable pills with "×", input field at end
   - Enter/comma to add, backspace on empty removes last
   - Saves as frontmatter array on change

7. **Description**
   - Editable textarea
   - Debounced save (300ms) — calls `updateTask(filePath, {}, newBody)` with updated description section
   - Sets `taskDetailDirty = true` while user is typing

8. **Definition of Done (DoD)**
   - Interactive checklist parsed from body
   - Each `- [x]` / `- [ ]` rendered as checkbox + text
   - Clicking checkbox toggles it → immediate write
   - "Add item" input at bottom → enter to append `- [ ] <text>`
   - Each item has a subtle hover delete button → removes line from body
   - Progress indicator: `3/5 complete` with mini progress bar

9. **Linked decisions** (read-only in Phase 4)
   - List of linked decision IDs (`D-001`, `D-002`) shown as muted badges
   - No interactive editing — deferred to Phase 9 when decision infrastructure exists
   - If no decisions linked, section is hidden

10. **Context for agent**
    - Editable textarea for `## Context for agent` section
    - Debounced save (300ms)
    - Sets `taskDetailDirty = true` while user is typing

11. **Metadata footer**
    - Created date (read-only)
    - File path in mono (read-only, dimmed)
    - Delete button (red text) → confirmation: "Archive this task?" → calls `archiveTask(filePath)`

### 3.2 TaskCard Click Handler

**File:** `src/renderer/src/components/Board/TaskCard.tsx` (modify)

- Add `onClick` to the card's root `<div>` → calls `useDataStore.getState().setSelectedTask(task.id)`
- Show `selected` state via accent border when `task.id === selectedTaskId`
- Keep `handleMilestoneClick` with `stopPropagation()` so it doesn't also select the task

### 3.3 Inline Edit Component

**File:** `src/renderer/src/components/shared/InlineEdit.tsx`
**Styles:** `src/renderer/src/components/shared/InlineEdit.module.css`

```tsx
interface InlineEditProps {
  value: string;
  onSave: (value: string) => void;
  className?: string;
  placeholder?: string;
  tag?: "h2" | "h3" | "span"; // what HTML element to render in display mode
}
```

- Renders as text by default, switches to input on click/enter
- Enter or blur to save, Escape to cancel (reverts to original value)
- Trims whitespace, rejects empty (reverts on empty)
- Reused for task title, milestone title

### 3.4 Tag Input Component

**File:** `src/renderer/src/components/shared/TagInput.tsx`
**Styles:** `src/renderer/src/components/shared/TagInput.module.css`

```tsx
interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}
```

- Shows tags as removable pills with "×"
- Input field at end, enter/comma to add, backspace on empty removes last tag
- Deduplicates (case-insensitive)

### 3.5 Body Section Parser

**File:** `src/renderer/src/utils/taskBodyParser.ts` (new — renderer-side utility)

Alternatively, this can live in `src/shared/` if both main and renderer need it.

```ts
export interface DodItem {
  text: string;
  checked: boolean;
}

export interface TaskBody {
  description: string;
  dod: DodItem[];
  contextForAgent: string;
  otherSections: { heading: string; content: string }[]; // preserve unknown sections
}

export function parseTaskBody(body: string): TaskBody;
export function serializeTaskBody(parsed: TaskBody): string;
```

**Parsing rules:**

- Split body by `## ` heading markers (case-insensitive matching for known sections)
- Known headings: `Description`, `Definition of Done` (also match `DoD`, `Checklist`), `Context for agent` (also match `Context for Agent`, `Agent context`)
- Unknown sections preserved in `otherSections` and re-serialized in their original position
- If a section heading is not found, its value is empty string / empty array
- Parser is best-effort — never fails. Falls back to treating entire body as description if no headings found
- `rawBody` stored alongside parsed sections for fallback

---

## Part 4 — Task CRUD Operations

### 4.1 Create Task

**Trigger:** "+ Add ticket" button in each kanban column footer (currently non-functional in `Column.tsx`), or "New task" button in `BoardToolbar`

**Flow:**

1. Click "+ Add ticket" or "New task"
2. Call `createTask('New task')` from `taskActions.ts`
3. IPC creates `T-XXX-new-task.md` in `.tasks/backlog/` (always starts in backlog regardless of which column)
4. Returns the created `TaskInfo` → auto-selects via `setSelectedTask(id)`
5. Chokidar fires `workspace:dataChanged` → board refreshes with new card
6. Detail panel opens with title field focused for immediate editing

### 4.2 Move Task (Drag and Drop)

**Library:** `@dnd-kit/core` only. `@dnd-kit/sortable` is NOT needed since we don't support within-column reordering in v1.

**Implementation:**

1. Wrap `Board` in `<DndContext>` + `<DragOverlay>` providers
2. Each `Column` wraps its drop zone with `useDroppable()`
3. Each `TaskCard` wraps with `useDraggable()`
4. On `onDragEnd`:
   - Determine source column (`task.status`) and target column (`over.id`)
   - If same column: no-op
   - If different column: call `moveTask(task.filePath, toStatus)`
   - Main process: reads file → updates `status` in frontmatter → atomic writes to new dir → deletes old file
   - Chokidar triggers board refresh

**Move operation safety (main process):**

1. Read current file content from source path
2. Parse frontmatter, update `status` field
3. Atomic write to destination directory (new path)
4. Delete source file
5. If delete fails after successful write: log warning (duplicate exists, but no data loss)

**Visual feedback during drag:**

- `DragOverlay` renders a ghost of the card with slight scale (1.02) and opacity (0.9)
- Target column gets `--accent-dim` background highlight
- Source card placeholder shows faded/dashed border

### 4.3 Delete (Archive) Task

**Trigger:** Delete button in task detail panel metadata footer

**Flow:**

1. Click delete → `window.confirm("Archive this task? It will be moved to .tasks/archive/")`
2. Confirm → call `archiveTask(task.filePath)`
3. Main process moves file to `.tasks/archive/`, creates dir if needed
4. Close detail panel → `clearSelectedTask()`
5. Chokidar fires refresh

### 4.4 Task Body Editing Strategy

The task `.md` file has two parts: YAML frontmatter and markdown body.

**Frontmatter updates** (title, priority, agent, tags, milestone, decisions, status):

- Immediate save on change via `updateTask(filePath, { field: value })`
- Main process does read-merge-write: reads current file, updates only the specified fields, writes back
- `gray-matter` handles YAML serialization including proper escaping of special characters (colons, quotes, etc.)

**Body updates** (description, DoD, context-for-agent):

- Renderer parses body into sections using `parseTaskBody()`
- Each section edited independently in the UI
- On save: `serializeTaskBody()` reconstructs full body → `updateTask(filePath, {}, newBody)`
- Debounced save (300ms) for free-text fields (description, context)
- Immediate save for DoD checkbox toggles
- `taskDetailDirty` flag set to `true` during edits, prevents chokidar from clobbering in-flight changes

**Known limitation:** `gray-matter.stringify()` may reformat YAML slightly differently from the original (date quoting, array style, field order). A "save without changes" may produce a git diff. This is accepted behavior — documenting here for awareness.

---

## Part 5 — Milestone CRUD

### 5.1 Milestone Detail Panel Enhancements

**File:** `src/renderer/src/components/Milestones/MilestoneDetail.tsx` (modify existing)

Currently display-only. Enhance with:

1. **Inline-editable title** — reuse `<InlineEdit>` component
2. **Status toggle button** — "Open" / "Closed" button, saves to frontmatter via `updateMilestone(filePath, { status })`
3. **Editable tags** — reuse `<TagInput>` component
4. **Editable description** — textarea with debounced save (300ms)
5. **"Create task in milestone" button** — calls `createTask('New task')` with milestone pre-filled via a follow-up `updateTask(filePath, { milestone: milestoneId })`, then switches to board view and selects the task
6. **Linked tasks** — already shown. Enhance click handler: clicking a task row → `setActiveView('board')` + `setMilestoneFilter(milestoneId)` + `setSelectedTask(taskId)`

### 5.2 Create Milestone

**Trigger:** "New milestone" button in milestone list toolbar

**Flow:**

1. Click "New milestone"
2. Call `createMilestone('New milestone')` from `milestoneActions.ts`
3. IPC creates `M-XXX-new-milestone.md` in `.milestones/`
4. Returns created `MilestoneInfo` → auto-select via `setSelectedMilestone(id)`
5. Chokidar fires `workspace:dataChanged`
6. Detail panel opens with title field focused

### 5.3 Milestone List Toolbar

**File:** `src/renderer/src/components/Milestones/MilestoneToolbar.tsx`
**Styles:** `src/renderer/src/components/Milestones/MilestoneToolbar.module.css`

Simple toolbar above the milestone list:

- "New milestone" button (+ icon)
- Filter: "All" / "Open only" / "Closed only" (default: "All")

---

## Part 6 — Board Integration + Cross-Navigation

### 6.1 Board Toolbar Enhancement

**File:** `src/renderer/src/components/Board/BoardToolbar.tsx` (modify)

Add "New task" button (+ icon) alongside the existing milestone filter dropdown.

### 6.2 Cross-Navigation Flows

1. **Task card → Task detail:** Click card → detail panel opens on the right
2. **Task milestone label → Milestone detail:** Click milestone label on card → switch to milestones view + select that milestone (already implemented)
3. **Milestone linked task → Task on board:** Click task row in milestone detail → `setActiveView('board')` + `setMilestoneFilter(milestoneId)` + `setSelectedTask(taskId)`
4. **"Create task in milestone" → Board + detail:** Create task with milestone → `setActiveView('board')` + `setSelectedTask(newTaskId)`

### 6.3 MainArea Layout Changes

**File:** `src/renderer/src/components/MainArea/MainArea.tsx` (modify)

Board view layout:

```
selectedTaskId ?
  [ Board (flex: 1, transition: flex-basis 200ms) ][ TaskDetailPanel (360px) ]
:
  [ Board (flex: 1) ]
```

---

## Part 7 — Keyboard Shortcuts

**File:** `src/renderer/src/hooks/useKeyboardShortcuts.ts` (extend)

| Shortcut | Action                                | Context                                                        |
| -------- | ------------------------------------- | -------------------------------------------------------------- |
| `N`      | Create new task                       | Board view active (`activeView === 'board'`), no input focused |
| `Escape` | Close detail panel / deselect         | Detail panel open                                              |
| `B`      | Move selected task to Backlog         | Task selected, no input focused, board view                    |
| `D`      | Move selected task to Doing           | Task selected, no input focused, board view                    |
| `R`      | Move selected task to Review          | Task selected, no input focused, board view                    |
| `F`      | Move selected task to Done (Finished) | Task selected, no input focused, board view                    |

**Note:** Single-letter shortcuts (B/D/R/F) instead of number keys 1-4 — avoids conflicts with typing numbers in input fields and is more mnemonic. All shortcuts check `activeView === 'board'` via `useNavStore` and verify no input/textarea has focus.

---

## Implementation Order

Recommended sequence to minimize blocked work and enable incremental testing:

| Step | Description                                                                      | Depends On    | Est. Effort |
| ---- | -------------------------------------------------------------------------------- | ------------- | ----------- |
| 1    | Atomic write utility + chokidar `.tmp` ignore                                    | —             | S           |
| 2    | Task write functions (serialize, create, read-merge-write update, move, archive) | Step 1        | M           |
| 3    | Milestone write functions (serialize, create, read-merge-write update)           | Step 1        | S           |
| 4    | IPC handlers for all task + milestone mutations (with input validation)          | Steps 2–3     | M           |
| 5    | Preload API extensions + type declarations                                       | Step 4        | S           |
| 6    | Standalone action functions (taskActions.ts, milestoneActions.ts)                | Step 5        | S           |
| 7    | Zustand store extensions (selectedTask, dirty flag)                              | Step 5        | S           |
| 8    | Shared UI components (InlineEdit, TagInput) — parallel with steps 1–7            | —             | M           |
| 9    | Body section parser (parseTaskBody / serializeTaskBody)                          | —             | S           |
| 10   | TaskDetailPanel component (full panel, all sections)                             | Steps 6–9     | L           |
| 11   | TaskCard onClick + MainArea layout + panel transitions                           | Steps 7, 10   | S           |
| 12   | Drag-and-drop between columns (@dnd-kit/core)                                    | Steps 6, 7    | M           |
| 13   | Create task flow (toolbar button, column button, auto-select)                    | Steps 6, 10   | S           |
| 14   | Archive task flow                                                                | Steps 6, 10   | S           |
| 15   | Milestone detail editing enhancements                                            | Steps 3, 6, 8 | M           |
| 16   | Create milestone flow + MilestoneToolbar                                         | Steps 3, 6    | S           |
| 17   | Cross-navigation flows                                                           | Steps 10, 15  | S           |
| 18   | Keyboard shortcuts (N, Escape, B/D/R/F)                                          | Steps 10–14   | S           |

**Parallelizable work:** Steps 8–9 have no backend dependencies and can be built alongside steps 1–7.

**Size key:** S = < 1 hour, M = 1–3 hours, L = 3–6 hours

**Total estimated effort:** ~20–30 hours

---

## File Manifest

### New files to create

| File                                                                 | Purpose                        |
| -------------------------------------------------------------------- | ------------------------------ |
| `src/main/fileWriter.ts`                                             | Atomic write utility           |
| `src/renderer/src/actions/taskActions.ts`                            | Task mutation functions        |
| `src/renderer/src/actions/milestoneActions.ts`                       | Milestone mutation functions   |
| `src/renderer/src/components/TaskDetail/TaskDetailPanel.tsx`         | Task detail panel              |
| `src/renderer/src/components/TaskDetail/TaskDetailPanel.module.css`  | Task detail panel styles       |
| `src/renderer/src/components/shared/InlineEdit.tsx`                  | Inline edit component          |
| `src/renderer/src/components/shared/InlineEdit.module.css`           | Inline edit styles             |
| `src/renderer/src/components/shared/TagInput.tsx`                    | Tag input component            |
| `src/renderer/src/components/shared/TagInput.module.css`             | Tag input styles               |
| `src/renderer/src/components/Milestones/MilestoneToolbar.tsx`        | Milestone list toolbar         |
| `src/renderer/src/components/Milestones/MilestoneToolbar.module.css` | Milestone toolbar styles       |
| `src/renderer/src/utils/taskBodyParser.ts`                           | Body section parser/serializer |

### Existing files to modify

| File                                                         | Changes                                                        |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| `src/main/tasks.ts`                                          | Add write functions, ID generator with session cache           |
| `src/main/milestones.ts`                                     | Add write functions, ID generator                              |
| `src/main/ipc/tasks.ts`                                      | Add 8 new IPC handlers with validation                         |
| `src/main/watchers.ts`                                       | Add `ignored: /\.tmp$/` to task and milestone watchers         |
| `src/preload/index.ts`                                       | Add `tasks` and `milestones` namespaces                        |
| `src/preload/index.d.ts`                                     | Add type declarations for new IPC channels                     |
| `src/shared/types.ts`                                        | Add `TaskFrontmatter`, `MilestoneFrontmatter`, `DodItem` types |
| `src/renderer/src/stores/useDataStore.ts`                    | Add selectedTask, taskDetailDirty, dirty-aware fetchData       |
| `src/renderer/src/components/MainArea/MainArea.tsx`          | Board layout with detail panel                                 |
| `src/renderer/src/components/MainArea/MainArea.module.css`   | Flex layout for board + panel with transition                  |
| `src/renderer/src/components/Board/Board.tsx`                | DndContext wrapper                                             |
| `src/renderer/src/components/Board/Column.tsx`               | useDroppable, functional add button                            |
| `src/renderer/src/components/Board/TaskCard.tsx`             | onClick + useDraggable + selected state                        |
| `src/renderer/src/components/Board/BoardToolbar.tsx`         | Add "New task" button                                          |
| `src/renderer/src/components/Milestones/MilestoneDetail.tsx` | Editable fields, create task button                            |
| `src/renderer/src/components/Milestones/MilestoneList.tsx`   | Include toolbar                                                |
| `src/renderer/src/hooks/useKeyboardShortcuts.ts`             | Add N, Escape, B/D/R/F shortcuts                               |

### NPM dependencies to add

| Package              | Purpose                           |
| -------------------- | --------------------------------- |
| `@dnd-kit/core`      | Drag and drop framework           |
| `@dnd-kit/utilities` | CSS utilities for drag transforms |

(`@dnd-kit/sortable` is NOT needed — no within-column reordering in v1)

---

## Testing Strategy

### Manual Testing Checklist

- [ ] Create a task → file appears in `.tasks/backlog/` with correct frontmatter and generated ID
- [ ] Edit task title → file updated via read-merge-write, no data loss
- [ ] Toggle DoD checkbox → file updated, progress count changes on card
- [ ] Add/remove tags → frontmatter array updates correctly
- [ ] Change priority → badge color updates on card, file saves
- [ ] Set agent → frontmatter updates
- [ ] Set milestone → milestone label appears on card, milestone progress updates
- [ ] Drag card between columns → file moves to correct directory, status in frontmatter updates
- [ ] Archive task → file moves to `.tasks/archive/`, card disappears
- [ ] Create milestone → file appears in `.milestones/` with correct frontmatter
- [ ] Edit milestone title and description → file updates via read-merge-write
- [ ] Close milestone → status changes to closed, badge updates
- [ ] "Create task in milestone" → task created with milestone pre-filled in frontmatter
- [ ] Click milestone label on card → navigates to milestone detail
- [ ] Click task in milestone detail → navigates to board with task selected
- [ ] Keyboard shortcuts: N (create), Escape (close panel), B/D/R/F (move task)
- [ ] Detail panel open/close transitions smooth
- [ ] Drag visual feedback (ghost card, column highlight)
- [ ] Rapid double-click "New task" → two tasks created with different IDs (no race)
- [ ] Edit task while agent modifies a different task → no clobbering, both changes preserved

### Edge Cases to Verify

- Creating a task when `.tasks/` directory doesn't exist yet (initTaskDirs creates it)
- Task with no DoD section (body has no `## Definition of Done`) — section shows as empty
- Task with extra custom sections in body — preserved on save by `otherSections`
- Task with no body at all — all sections empty, editing any section creates it
- Milestone with zero linked tasks — progress bar hidden
- Rapid successive edits — debounce prevents file thrashing, dirty flag prevents clobbering
- Very long task titles — truncated on card, full display in panel, no YAML breakage
- Special characters in titles: colons, quotes, newlines — gray-matter YAML escaping handles them
- Task ID uniqueness after archive — IDs never reused (archive dir is scanned by nextTaskId)
- Move task where delete-old-file fails — duplicate logged, no data loss
- Path traversal attempt via IPC — validated and rejected
- `.tmp` files during atomic write — ignored by chokidar, no spurious refresh
