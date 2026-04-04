---
id: T-014
title: >-
  Unify agent experience — move execution from terminal into structured Agent
  tab
status: done
created: '2026-04-04'
agent: opencode
tags:
  - agent
  - ux
  - architecture
autoRun: true
---

## Description

Grove currently has two separate agent interaction surfaces: a PlanChat UI (backlog only, restricted read-only agent) and a terminal-based execution flow (doing only, unrestricted agent typed into a PTY). This creates a disjointed experience — planning produces a structured chat with thinking blocks and markdown rendering, while execution dumps raw terminal output that's hard to re-read.

This task unifies both into a single Agent tab inside the task detail panel. For backlog tasks it works exactly as today (planning mode — restricted, workspace root CWD). For doing tasks it becomes execution mode (unrestricted, worktree CWD). The terminal panel remains available for manual shell use but is no longer the primary execution surface.

**Architecture decision: Option A (single tab, two modes).**

- Tab label: "Plan" for backlog, "Agent" for doing
- Same component, same streaming infrastructure, different system prompt and CWD
- Plan and execution sessions are fully separate (different frontmatter fields, different store keys)
- Terminal panel remains for manual use; auto-typed agent commands are removed

### Key constraints

- The execution agent runs with CWD set to the worktree path, not workspace root
- For copilot execution: remove `--deny-tool=shell` and the `--allow-tool=write(...)` restriction
- For opencode execution: different prompt (no restrictions on code/shell/file access)
- Session persistence uses separate frontmatter fields (`execSessionId`, `execSessionAgent`, `execModel`) to avoid collision with plan sessions
- The Agent tab must stay mounted (hidden via CSS) when the user switches to Edit/Changes tabs, preventing cancel-on-unmount — same pattern as current PlanChat
- Chat messages remain in-memory (Zustand, no persistence) — this is a known limitation for both plan and execution modes

### Dependency note

T-012 (PlanChat background agent) addresses cancel-on-unmount when the task detail panel itself closes. That work is complementary but independent — this task only needs the tab-level always-mounted behavior that already exists.

## Phase 1: Extend PlanManager with execution mode

**Goal:** PlanManager can spawn unrestricted agent processes in a worktree directory.

Changes to `src/main/planManager.ts`:

- Add `mode: "plan" | "execute"` parameter to `run()` method signature
- Add `cwd` parameter (replaces hardcoded workspace root) — caller passes workspace root for plan, worktree absolute path for execute
- Add `buildExecutionArgs()` method (or extend `buildArgs()` with mode):
  - opencode: same `run --format json` but without the planning-restricted prompt (prompt is built renderer-side)
  - copilot: remove `--deny-tool=shell`, remove `--allow-tool=write(...)` restriction

Changes to `src/main/ipc/plan.ts`:

- Add `mode` and optional `worktreePath` to the `plan:send` input type
- When `mode === "execute"`: use `worktreePath` as CWD, skip taskFilePath validation against `.tasks/` (the agent may write anywhere in the worktree)
- Add `plan:saveExecSession` handler (or extend `plan:saveSession` with a mode parameter) that writes `execSessionId`, `execSessionAgent`, `execModel` to frontmatter

Changes to `src/preload/index.ts` + `src/preload/index.d.ts`:

- Add `mode` and `worktreePath` to `plan:send` input type
- Add mode to `plan:saveSession` input type

Changes to `src/shared/types.ts`:

- Add `mode?: "plan" | "execute"` to the plan send input type
- Add `execSessionId`, `execSessionAgent`, `execModel` fields to `TaskInfo` and `TaskFrontmatter`

Changes to `src/main/tasks.ts`:

- Parse new `execSessionId`, `execSessionAgent`, `execModel` fields from frontmatter in `parseTaskFile()`
- Include new fields in `buildFrontmatter()`

## Phase 2: Generalize PlanChat component

**Goal:** PlanChat accepts a `mode` prop and renders appropriately for both planning and execution.

Changes to `src/renderer/src/components/TaskDetail/PlanChat.tsx`:

- Add `mode: "plan" | "execute"` prop to `PlanChatProps`
- New `buildFirstExecutionMessage()` function:
  - References the task file path (post-move, in `.tasks/doing/`)
  - Instructs the agent to work through the DoD checkboxes
  - No restrictions on code, shell, or file access
  - Includes the full task content (read via `tasks.readRaw`)
- Update `handleSend()` to pass `mode` and `worktreePath` via IPC
- Update `handleNewSession()` to clear the correct frontmatter fields based on mode (`planSessionId` vs `execSessionId`)
- Update `initSession()` call to use mode-appropriate session ID from task (`task.planSessionId` vs `task.execSessionId`)
- Header label: "Plan with agent" for plan mode, "Execute with agent" for execute mode
- Empty state text: "Describe what you want to plan..." vs "Send a message to start executing this task..."
- Store key: prefix with mode to prevent collision (see Phase 3)

## Phase 3: Update store to support dual sessions

**Goal:** A single task can have both a plan session (from backlog) and an execution session (from doing) without collision.

Changes to `src/renderer/src/stores/usePlanStore.ts`:

- Change session key from `taskId` to `${mode}:${taskId}` (e.g., `plan:T-004`, `exec:T-004`)
- All store methods (`initSession`, `appendUserMessage`, `startAgentMessage`, `applyChunk`, etc.) accept a composite key
- Or: add a `mode` field to `PlanSession` and keep taskId keys but scope lookups

Changes to `src/renderer/src/App.tsx`:

- The `plan:chunk` handler (`App.tsx:150-181`) needs to know which mode a chunk belongs to
  - Option A: PlanManager includes mode in the chunk event (add mode to the IPC event signature)
  - Option B: Track which mode is active per taskId in the store
  - **Recommend Option A** — add mode to the `plan:chunk` IPC event. PlanManager already knows the mode from the `run()` call. Pass it through: `mainWindow.webContents.send("plan:chunk", taskId, mode, chunk)`
- Update `saveSession` call in the chunk handler to use mode-appropriate frontmatter fields

Changes to `src/shared/types.ts`:

- Add `mode` field to `PlanChunk` or create a separate envelope type for the IPC event

## Phase 4: Update TaskDetailPanel tabs

**Goal:** The Agent/Plan tab appears for both backlog and doing tasks.

Changes to `src/renderer/src/components/TaskDetail/TaskDetailPanel.tsx`:

- Remove the `task.status === "backlog"` gate on the Plan tab button (line 483)
- Tab label: `task.status === "backlog" ? "Plan" : "Agent"`
- Pass `mode="plan"` for backlog, `mode="execute"` for doing
- For doing tasks, pass `worktreePath` computed from `task.worktree` (resolve to absolute path using workspace path)
- The always-mounted pattern (lines 504-518) extends to doing tasks:
  ```tsx
  {(task.status === "backlog" || task.status === "doing") && (
    <div style={activeTab === "plan" ? visibleStyle : hiddenStyle}>
      <PlanChat task={task} mode={mode} onClose={...} />
    </div>
  )}
  ```
- Default tab: backlog defaults to "plan", doing defaults to "agent" (update `useEffect` at line 114)
- Remove the standalone "Plan with agent" button from topBar (line 431-438) — it's redundant with the tab
- The "auto-run: on/off" toggle stays visible for backlog tasks (unchanged)

## Phase 5: Update handleDragToDoing flow

**Goal:** Drag-to-doing no longer types agent commands into the terminal. Optionally auto-opens the Agent tab.

Changes to `src/renderer/src/components/Board/Board.tsx`:

- Remove `agentToCommand()` function (lines 186-209) — no longer needed
- Remove `shellSingleQuote()` function (lines 181-183)
- Remove the `setTimeout` + `pty.write` agent dispatch (lines 283-287)
- Keep all worktree creation, PTY creation, and terminal tab logic — the terminal remains for manual use
- When `autoRun === true`:
  - After worktree + terminal setup completes, auto-select the task: `useDataStore.getState().selectTask(task.id)`
  - The task detail panel opens with the Agent tab (per Phase 4 default tab logic)
  - **Do NOT auto-send the first execution message** — let the user review and press Send. This avoids accidental expensive agent runs and gives the user a chance to add context.
- When `autoRun === false`:
  - Same as above but don't auto-select the task. The user opens it manually.

## Phase 6: DoD completion check for execution mode

**Goal:** When the execution agent finishes (done chunk with exit code 0), check if all DoD items are complete and auto-move to review.

Changes to `src/renderer/src/App.tsx`:

- In the `plan:chunk` handler, when `chunk.type === "done"` and `mode === "execute"`:
  - Re-read the task from disk (the agent may have checked off DoD items during the run)
  - If `dodTotal > 0 && dodDone === dodTotal`: auto-move to review via `window.api.tasks.move()`
  - This mirrors the existing terminal exit handler in `useTerminalStore.ts:72-80`
- The existing chokidar watcher already detects file changes and updates the data store, but there's a timing issue: the `done` chunk may arrive before chokidar processes the last file write. Solution: explicitly re-read the task file on `done` rather than relying on the in-memory store.

Changes to `src/renderer/src/stores/useTerminalStore.ts`:

- The terminal exit handler's DoD check (line 72-80) stays — the user might still manually run an agent in the terminal
- No changes needed

## Definition of Done

- [ ] `PlanManager.run()` accepts a `mode` parameter and spawns unrestricted agents for execution mode
- [ ] `PlanManager.buildArgs()` removes copilot restrictions (`--deny-tool=shell`, `--allow-tool`) in execution mode
- [ ] IPC `plan:send` accepts `mode` and `worktreePath` parameters
- [ ] IPC `plan:chunk` includes `mode` so the renderer routes chunks to the correct session
- [ ] `plan:saveSession` writes mode-appropriate frontmatter fields (`planSessionId` vs `execSessionId`)
- [ ] `PlanChat` component accepts `mode` prop and builds the correct prompt for each mode
- [ ] Execution prompt references the task file, instructs agent to work through DoD, has no restrictions
- [ ] `usePlanStore` supports separate plan and execution sessions for the same task without collision
- [ ] `TaskDetailPanel` shows "Plan" tab for backlog tasks and "Agent" tab for doing tasks
- [ ] The Agent/Plan tab stays mounted (hidden CSS) across tab switches to prevent cancel-on-unmount
- [ ] Default tab is "Plan" for backlog, "Agent" for doing
- [ ] `handleDragToDoing` no longer types agent commands into the terminal
- [ ] `agentToCommand()` and `shellSingleQuote()` functions are removed from Board.tsx
- [ ] Terminal panel still works for manual use — PTY creation and terminal tabs remain
- [ ] When `autoRun === true` and task moves to doing, task detail opens with Agent tab selected
- [ ] Agent completion (done chunk, exit 0) triggers DoD check and auto-move to review if complete
- [ ] DoD check re-reads the task from disk (not in-memory store) to avoid stale data
- [ ] New frontmatter fields (`execSessionId`, `execSessionAgent`, `execModel`) are parsed in `parseTaskFile()` and serialized in `buildFrontmatter()`
- [ ] Existing plan sessions on backlog tasks continue to work without regression
- [ ] Model selection works for both plan and execution modes
- [ ] Agent/model selection is locked after session starts (same behavior as current plan)

## Scope exclusions (intentional)

- **Chat message persistence:** Messages remain in-memory (Zustand). Persisting to disk is a separate concern.
- **T-012 (background agent on panel close):** The cancel-on-unmount behavior when the entire task detail panel closes is unchanged. T-012 addresses this independently.
- **Multiple simultaneous execution sessions:** Only one execution session per task. Starting a new session cancels the previous one.
- **Review/done status agent tab:** The Agent tab is only available for backlog and doing. Review and done tasks use Edit and Changes tabs only.

## Context for agent

### Key files to modify

**Main process:**

- `src/main/planManager.ts` — add mode-aware args and CWD
- `src/main/ipc/plan.ts` — add mode/worktreePath to IPC, extend saveSession
- `src/main/tasks.ts` — parse/serialize new exec frontmatter fields

**Renderer:**

- `src/renderer/src/components/TaskDetail/PlanChat.tsx` — mode prop, dual prompt builders
- `src/renderer/src/components/TaskDetail/TaskDetailPanel.tsx` — tab gating, mode routing
- `src/renderer/src/components/Board/Board.tsx` — remove agentToCommand, update autoRun flow
- `src/renderer/src/stores/usePlanStore.ts` — mode-scoped session keys
- `src/renderer/src/App.tsx` — route chunks by mode, DoD check on execution done

**Shared:**

- `src/shared/types.ts` — new fields on TaskInfo/TaskFrontmatter, mode on IPC types

**Preload:**

- `src/preload/index.ts` — update plan.send signature
- `src/preload/index.d.ts` — update type definitions

### Architecture invariants to preserve

- All filesystem/git/pty operations stay in the main process (never shell out from renderer)
- The task file at `.tasks/{status}/T-XXX.md` is always in the workspace root, never in the worktree
- Chokidar's `awaitWriteFinish` with `stabilityThreshold: 150ms` prevents double-reads during atomic writes
- The per-file write lock in `tasks.ts` serializes concurrent writes to the same file
- Path traversal checks must be maintained (but relaxed for execution mode CWD which can be a worktree path outside `.tasks/`)
