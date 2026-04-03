---
id: T-006
title: Remove milestone concept from Grove
priority: high
created: '2026-04-03'
tags:
  - refactor
  - cleanup
status: done
agent: opencode
---

## Description

Remove every trace of the "milestone" concept from Grove. Tasks, types, IPC handlers,
watchers, stores, UI components, and documentation all contain milestone references.
This plan removes them all in a layered order that keeps TypeScript valid at every step.

The ordering is intentional: consumers are removed before the types they depend on,
so the compiler stays clean throughout. After each numbered step, verify that
`tsc --noEmit` passes before proceeding to the next.

## Definition of Done

- [x] All files listed under Step 1 are deleted from the repository
- [x] The `src/renderer/src/components/Milestones/` directory is removed entirely
- [x] No `milestone` references remain in any `.ts` or `.tsx` file
- [x] No `.milestones` references remain in watchers or filesystem exclusion lists
- [x] `VISION.md` contains no milestone content
- [x] `tsc --noEmit` passes cleanly with zero errors
- [x] All existing tests pass; the deleted contextGenerator test case is gone
- [x] The app builds and runs: board view works, no console errors related to milestones

## Step 1 — Delete entire files and the Milestones component folder

Delete the following files outright. They have no callers outside the milestone
feature (all consumers are removed in later steps).

**Source files:**

1. `src/main/milestones.ts`
2. `src/renderer/src/actions/milestoneActions.ts`

**Milestones component folder — all six files:** 3. `src/renderer/src/components/Milestones/MilestoneList.tsx` 4. `src/renderer/src/components/Milestones/MilestoneList.module.css` 5. `src/renderer/src/components/Milestones/MilestoneRow.tsx` 6. `src/renderer/src/components/Milestones/MilestoneRow.module.css` 7. `src/renderer/src/components/Milestones/MilestoneDetail.tsx` 8. `src/renderer/src/components/Milestones/MilestoneDetail.module.css`

After deletion the `src/renderer/src/components/Milestones/` directory will be
empty and should also be removed.

---

## Step 2 — Strip renderer components

### `src/renderer/src/components/MainArea/MainArea.tsx`

- Remove `import { MilestoneList } from "../Milestones/MilestoneList"`
- Remove `import { MilestoneDetail } from "../Milestones/MilestoneDetail"`
- Remove `const selectedMilestoneId = useDataStore((s) => s.selectedMilestoneId)`
- Remove the entire `if (activeView === "milestones") { ... }` render branch

### `src/renderer/src/components/Sidebar/BottomNav.tsx`

- Remove the entire `"milestones"` nav item object from the `navItems` array
  (includes the label, id, and SVG diamond icon)

### `src/renderer/src/components/Board/Board.tsx`

- Remove `const milestones = useDataStore((s) => s.milestones)`
- Remove `const milestoneFilter = useDataStore((s) => s.milestoneFilter)`
- Remove the `filtered` useMemo block that filters tasks by milestone; replace
  all uses of `filtered` with `tasks` directly
- Remove the `milestoneMap` useMemo block
- Remove `milestones={milestones}` prop from `<BoardToolbar>`
- Remove `milestoneMap={milestoneMap}` prop from `<Column>`
- Remove the `milestoneName={...}` prop from the `<TaskCard>` in the DragOverlay

### `src/renderer/src/components/Board/BoardToolbar.tsx`

- Remove `import type { MilestoneInfo } from "@shared/types"`
- Remove the `BoardToolbarProps` interface entirely
- Remove `milestones` from the function signature
- Remove `const milestoneFilter` and `const setMilestoneFilter` store reads
- Remove `const openMilestones`
- Remove the entire `<select>` element for milestone filtering

### `src/renderer/src/components/Board/BoardToolbar.module.css`

- Remove the `.select` rule and `.select:focus` rule; they are now unused
  (the filter `<select>` is gone, and `.select` was only used by it)

### `src/renderer/src/components/Board/Column.tsx`

- Remove `milestoneMap: Map<string, string>` from the `ColumnProps` interface
- Remove `milestoneMap` from the destructured function parameters
- Remove the `milestoneName={...}` prop passed to `<TaskCard>`

### `src/renderer/src/components/Board/TaskCard.tsx`

- Remove `import { useNavStore } from "../../stores/useNavStore"` — it is only
  used inside `handleMilestoneClick`, which is also being removed
- Remove `milestoneName: string | null` from the `TaskCardProps` interface
- Remove `milestoneName` from the destructured function parameters
- Remove the entire `handleMilestoneClick` function
- Remove the milestone diamond render block: `{task.milestone && (...)}`

### `src/renderer/src/components/Board/TaskCard.module.css`

- Remove the `.milestone` rule
- Remove the `.milestone:hover` rule
- Remove the `.milestoneDiamond` rule

### `src/renderer/src/components/TaskDetail/TaskDetailPanel.tsx`

- Remove `const milestones = useDataStore((s) => s.milestones)`
- Remove the `openMilestones` useMemo block
- Remove the `handleMilestoneChange` handler function
- Remove the entire milestone `<select>` section (section 5 of the detail panel)

### `src/renderer/src/components/TaskDetail/TaskDetailPanel.module.css`

- Update the comment `/* ── Selects (agent, milestone) ──... */` to
  `/* ── Selects ──... */`
  (The `.fieldSelect` rule itself stays — it is still used by the agent select)

---

## Step 3 — Strip renderer stores

### `src/renderer/src/stores/useDataStore.ts`

- Remove `import type { MilestoneInfo } from "@shared/types"`
- In the `DataState` interface, remove:
  - `milestones: MilestoneInfo[]`
  - `milestoneFilter: string | null`
  - `selectedMilestoneId: string | null`
  - `setMilestoneFilter: (filter: string | null) => void`
  - `setSelectedMilestone: (id: string | null) => void`
- In the store initializer, remove:
  - `milestones: []`
  - `milestoneFilter: null`
  - `selectedMilestoneId: null`
- In the `fetchData` action, remove `milestones: result.data.milestones`
  from the `set({...})` call
- Remove the `setMilestoneFilter` action implementation
- Remove the `setSelectedMilestone` action implementation
- In the `clear()` action, remove `milestones: []`, `milestoneFilter: null`,
  `selectedMilestoneId: null`

### `src/renderer/src/stores/useNavStore.ts`

- Remove `"milestones"` from the `View` union type, leaving:
  `export type View = "board" | "decisions" | "terminal" | "files"`

---

## Step 4 — Strip preload layer

### `src/preload/index.ts`

- Remove the entire `milestones` namespace from `contextBridge.exposeInMainWorld`
  (`milestones.create`, `milestones.update`, `milestones.readBody`)

### `src/preload/index.d.ts`

- Remove `MilestoneInfo` and `MilestoneFrontmatter` from the import list
- Remove the entire `milestones` namespace from the `ElectronAPI` interface

---

## Step 5 — Strip main-process files

### `src/main/ipc/tasks.ts`

- Remove `MilestoneInfo` and `MilestoneFrontmatter` from the type imports
- Remove the entire import from `"../milestones"` (`scanMilestones`,
  `createMilestone`, `updateMilestone`, `readMilestoneBody`)
- In the `workspace:data` handler:
  - Remove `const milestones = await scanMilestones(workspacePath, tasks)`
  - Update return value from `{ tasks, milestones }` to `{ tasks }`
- Remove the entire milestone CRUD section: all three handlers
  `milestone:create`, `milestone:update`, `milestone:readBody`

### `src/main/ipc/workspace.ts`

- Remove `import { initMilestoneDirs } from "../milestones"`
- Remove `await initMilestoneDirs(selectedPath)` in `workspace:add` handler
- Remove `await initMilestoneDirs(wPath)` in `workspace:setActive` handler

### `src/main/watchers.ts`

- Remove `let milestoneWatcher: chokidar.FSWatcher | null = null`
- Remove the entire milestone watcher setup block (the `chokidar.watch(...)` call
  on `.milestones/*.md` and its `.on("all", ...)` handler)
- Remove `"**/.milestones/**"` from the `fileTreeWatcher` ignored array
  (this entry is separate from the `milestoneWatcher` block — easy to miss)
- Remove `milestoneWatcher?.close()` and `milestoneWatcher = null` from
  `stopWatchers()`

### `src/main/contextGenerator.ts`

- Remove `MilestoneInfo` from the import (keep `TaskInfo`)
- Remove the local variable `let milestone: MilestoneInfo | null = null`
- Remove the `if (task.milestone) { milestone = await readMilestoneInfo(...) }` block
- Remove the `if (milestone) { ... }` render block for the `## Milestone:` section
- Remove the entire `readMilestoneInfo()` private helper function

### `src/main/tasks.ts`

- Remove `milestone: typeof data.milestone === "string" ? data.milestone : null`
  from the return object in `parseTaskFile()`
- Remove `if (fm.milestone) obj.milestone = fm.milestone` from `buildFrontmatter()`
- Remove `milestone: null` from the frontmatter object in `createTask()`

### `src/main/filesystem.ts`

- Remove `".milestones"` from the `ALWAYS_EXCLUDED` array

---

## Step 6 — Strip shared types

By this point every consumer of these types has been removed. Removing them now
will not cause any TypeScript errors.

### `src/shared/types.ts`

- Remove `milestone: string | null` from `TaskInfo`
- Remove the `MilestoneStatus` type alias
- Remove the `MilestoneInfo` interface (including the `taskCounts` sub-shape)
- Remove `milestones: MilestoneInfo[]` from `WorkspaceData`
- Update the section comment from `// ── Phase 4: Task & Milestone CRUD ──...`
  to `// ── Phase 4: Task CRUD ──...`
- Remove `milestone: string | null` from `TaskFrontmatter`
- Remove the `MilestoneFrontmatter` interface

---

## Step 7 — Update tests

### `src/main/__tests__/contextGenerator.test.ts`

- Remove `milestone: null` from the `makeTask()` factory; `milestone` will no
  longer be a field on `TaskInfo`
- Remove the entire test case "omits milestone section when task has no milestone";
  the milestone section no longer exists in the generated output

---

## Step 8 — Update VISION.md

Edit `VISION.md` to remove all milestone references:

- Remove `.milestones/` from the file structure listing
- Remove `milestone` from the task frontmatter field spec
- Remove the milestone file format section entirely
- Remove milestone UI sections: milestone list view, milestone detail panel,
  task card badge, milestone filter dropdown on board toolbar
- Remove milestone from the phase breakdown table and implementation notes

---

## Data and filesystem notes

- The `.milestones/` directory in workspaces currently contains no files.
  It can be deleted from any open workspaces, or left as an empty directory —
  it causes no harm and will no longer be created, watched, or shown in the file tree.
- No existing task files have `milestone: M-XXX` in their frontmatter, so no
  data migration is required.
- Any task files in external repos that happen to have a `milestone` frontmatter
  field will have that field silently ignored after this change.

## Context for agent

